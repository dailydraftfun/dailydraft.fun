import { journeyTestIds } from '../app/e2e/journey-test-ids';
import { revealCommitmentCopy } from '../app/duel/reveal-presentation';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const appOrigin = 'http://127.0.0.1:3001';
const entryTestIds = {
  authenticate: 'duel-entry-auth-prepare',
  confirmFunding: 'duel-entry-confirm-funding',
  connectWallet: 'duel-entry-connect-wallet',
  prepareFunding: 'duel-entry-prepare-funding',
  signAuthentication: 'duel-entry-auth-sign',
  stepper: 'duel-entry-stepper',
} as const;

test.use({ journeySeed: 'desktop-happy-path' });

test('completes the deterministic desktop duel from lobby through share and rematch', async ({
  context,
  journey,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appOrigin });
  await page.clock.install({ time: new Date('2099-01-01T00:00:00.000Z') });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
  });

  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview'),
  ]);

  const lobby = page.getByTestId(journeyTestIds.lobby);
  const primaryAction = page.getByTestId(journeyTestIds.primaryAction);
  await expect(lobby).toBeVisible();
  await expect(page.getByTestId(journeyTestIds.mode.matchmaking)).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId(journeyTestIds.entryTier)).toHaveText('$50.00');
  await expect(primaryAction).toHaveText(/Find a \$50 duel/);
  await primaryAction.click();

  const stepper = page.getByTestId(entryTestIds.stepper);
  await expect(stepper).toHaveAttribute('data-stage', 'connect');
  await expect(stepper).toContainText('Connect, verify, review, and fund');
  await stepper.getByTestId(entryTestIds.connectWallet).click();

  await expect(stepper).toHaveAttribute('data-stage', 'authenticate');
  await expect(stepper).toContainText('Authentication signature');
  await expect(stepper).toContainText('No transaction · no fee · no asset movement');
  await stepper.getByTestId(entryTestIds.authenticate).click();
  await expect(stepper.getByText(/Journey seed: desktop-happy-path/)).toBeVisible();
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/matchmaking/status`),
    stepper.getByTestId(entryTestIds.signAuthentication).click(),
  ]);

  await expect(stepper).toHaveAttribute('data-stage', 'review');
  await expect(stepper).toContainText('Selected pack $50.00');
  await expect(stepper).toContainText('Opponent Public matchmaking');
  await stepper.getByTestId(entryTestIds.prepareFunding).click();

  await expect(stepper).toHaveAttribute('data-stage', 'funding-review');
  await expect(stepper).toContainText('Value-bearing transaction');
  await expect(stepper).toContainText('Moves 0.01 SOL after your explicit wallet approval');
  await expect(stepper.getByText('Pack purchase', { exact: true })).toBeVisible();
  await expect(
    stepper.getByText('Not charged in this devnet step', { exact: true }),
  ).toBeVisible();
  await expect(stepper.getByTestId(entryTestIds.confirmFunding)).toHaveText(
    'Approve 0.01 SOL in wallet',
  );
  await stepper.getByTestId(entryTestIds.confirmFunding).click();

  const battle = page.getByTestId(journeyTestIds.battle);
  await expect(battle).toBeVisible();
  await expect(page.getByText(revealCommitmentCopy)).toBeVisible();
  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText(
    'Outcome locked. Reveal in 3…',
  );
  await expect(page.getByTestId(journeyTestIds.duelPhase)).toContainText('Outcome committed');

  const settled = journey.snapshot().duel;
  expect(settled?.status).toBe('settled');
  expect(settled?.result?.winnerSide).toBe('creator');
  expect(settled?.result?.comparisonMetric).toBe('insured-value');
  const resultHash = settled?.result?.resultHash;
  expect(resultHash).toBeTruthy();
  await expect(page.getByText(`Result hash ${shortReference(resultHash as string)}`)).toBeVisible();

  await page.clock.fastForward(6_000);

  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText('You won both pulls');
  await expect(page.getByTestId(journeyTestIds.duelPhase)).toHaveText('Complete');
  await expect(page.getByTestId(journeyTestIds.winner.you)).toHaveText('Winner');
  await expect(page.getByTestId(journeyTestIds.pullName.you)).toHaveText(
    'Charizard fixture pull',
  );
  await expect(page.getByTestId(journeyTestIds.pullValue.you)).toHaveText('$72.5');
  await expect(page.getByTestId(journeyTestIds.provider.you)).toHaveText('journey-fixture');
  await expect(page.getByTestId(journeyTestIds.pullName.opponent)).toHaveText(
    'Blastoise fixture pull',
  );
  await expect(page.getByTestId(journeyTestIds.pullValue.opponent)).toHaveText('$41');
  await expect(page.getByTestId(journeyTestIds.provider.opponent)).toHaveText('journey-fixture');
  await expect(page.getByTestId(journeyTestIds.resultMargin)).toHaveText('$31.5');
  await expect(page.getByTestId(journeyTestIds.resultTotalValue)).toHaveText('$113.5');
  await expect(page.getByTestId(journeyTestIds.settlementReference)).toHaveText(
    shortReference(settled?.transactionSignature as string),
  );

  await page.getByTestId(journeyTestIds.resultShare).click();
  await expect(page.getByText('Result link copied with its status-aware social preview.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    `I won a $50 Pack Duel with Charizard fixture pull at $72.5.\n${appOrigin}/duel/${settled?.id}`,
  );

  await page.getByTestId(journeyTestIds.resultRematch).click();
  await expect(lobby).toBeVisible();
  await expect(page.getByTestId(journeyTestIds.mode.direct)).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId(journeyTestIds.opponentWallet)).toContainText(
    'So111111…111112',
  );
  await expect(primaryAction).toHaveText(/Review \$50 rematch/);

  expect(journey.snapshot().requests).toEqual(
    expect.arrayContaining([
      'RPC getGenesisHash',
      'POST /auth/challenges',
      'POST /auth/sessions',
      'POST /matchmaking/search',
      'RPC sendTransaction',
      `POST /duels/${settled?.id}/transactions/reconciliation`,
      `POST /duels/${settled?.id}/open-packs`,
    ]),
  );
  expect(
    journey
      .snapshot()
      .requests.some((request) =>
        request.match(/^POST \/duels\/duel_fixture_[a-f0-9]+\/transactions\/intent_[a-f0-9]+\/submissions$/),
      ),
  ).toBe(true);
});

function shortReference(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
