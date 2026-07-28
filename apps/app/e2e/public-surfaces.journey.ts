import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import {
  privateFixtureEscrowAddress,
  privateFixtureOpponentWallet,
  privateFixtureSignature,
  privateFixtureWallet,
  publicSurfaceStatuses,
} from '../app/__journey/public-duel-receipt';
import { journeyTestIds } from '../app/e2e/journey-test-ids';
import { journeyApiOrigin, journeyOpponentWallet, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const appOrigin = 'http://127.0.0.1:3001';
const canonicalAppOrigin = 'https://app.dailydraft.fun';
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;

test.use({ journeySeed: 'public-surfaces' });

for (const rulesPath of [
  '/games/duel#rules',
  '/games/marketplace-flip#rules',
  '/games/crash#rules',
] as const) {
  test(`${rulesPath} activates the canonical rules target`, async ({ journey, page }) => {
    expect(journey.seed).toBe('public-surfaces');
    await page.goto(rulesPath);
    const rules = page.locator('#rules');

    await expect(rules).toBeVisible();
    await expect(rules).toBeFocused();
    await expect(rules).toHaveAttribute('tabindex', '-1');
  });
}

test('reports no serious or critical violations across the deterministic duel journey', async ({
  journey,
  page,
}) => {
  test.setTimeout(90_000);
  expect(journey.seed).toBe('public-surfaces');
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview'),
  ]);
  await expect(page.getByTestId(journeyTestIds.lobby)).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page, 'lobby');
  await page.getByTestId(journeyTestIds.mode.direct).click();
  await page.getByTestId(journeyTestIds.opponentWallet).fill(journeyOpponentWallet);

  await page.getByTestId(journeyTestIds.walletMenu).click();
  await page.getByTestId(journeyTestIds.walletOption).click();
  await page.getByTestId(journeyTestIds.walletMenu).click();
  await page.getByTestId(journeyTestIds.walletAuthenticationPrepare).click();
  await expect(page.getByTestId(journeyTestIds.walletAuthenticationSign)).toBeVisible();
  await expectViewportDialog(page, journeyTestIds.walletDialog);
  await expectNoSeriousOrCriticalViolations(page, 'wallet review');

  await page.getByTestId(journeyTestIds.walletAuthenticationSign).click();
  await expect(page.getByTestId(journeyTestIds.walletDialog)).toContainText(
    'Authenticated to play',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(journeyTestIds.walletDialog)).not.toBeVisible();

  await page.getByTestId(journeyTestIds.primaryAction).click();
  await expect(page.getByTestId('duel-entry-stepper')).toHaveAttribute('data-stage', 'review');
  await page.getByTestId('duel-entry-prepare-funding').click();
  await expect(page.getByTestId('duel-entry-confirm-funding')).toBeVisible();
  await expectViewportDialog(page, 'duel-entry-stepper');
  await expectNoSeriousOrCriticalViolations(page, 'transaction review');

  await page.getByTestId('duel-entry-confirm-funding').click();
  const battle = page.getByTestId(journeyTestIds.battle);
  await expect(battle).toBeVisible();
  await expect(battle.getByRole('heading', { level: 1 })).toBeVisible();
  const activeRules = battle.locator('#rules');
  await expect(
    activeRules.getByRole('heading', { level: 2, name: /Know the outcome path/ }),
  ).toBeVisible();
  await expect(activeRules.getByRole('link', { name: 'Return to active duel' })).toHaveAttribute(
    'href',
    '#duel-battle',
  );
  await expect(battle.locator('#duel-battle')).toBeVisible();
  expect(
    await battle
      .locator('.battle-shell')
      .evaluate(
        (battleShell, rules) =>
          Boolean(
            battleShell.compareDocumentPosition(rules as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        await activeRules.elementHandle(),
      ),
  ).toBe(true);
  await expect(page.getByLabel('Reveal progress')).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page, 'reveal');

  await expect(page.getByTestId(journeyTestIds.resultMargin)).toBeVisible({ timeout: 15_000 });
  await expectNoSeriousOrCriticalViolations(page, 'result');

  await page.getByRole('link', { name: 'Verified receipt' }).click();
  await expect(page.getByRole('heading', { name: /won the vault/i })).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page, 'receipt');
});

async function expectViewportDialog(page: Page, testId: string): Promise<void> {
  const dialog = page.getByTestId(testId);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${testId} must have measurable viewport geometry`).not.toBeNull();
  expect(viewport, 'the journey must declare a viewport').not.toBeNull();
  if (!box || !viewport) return;

  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

for (const surface of [
  {
    heading: /own the cards/i,
    label: 'marketing',
    url: 'http://127.0.0.1:3000',
  },
  {
    heading: /build on the duel protocol/i,
    label: 'docs',
    url: 'http://127.0.0.1:3002',
  },
  {
    heading: /dailydraft mcp/i,
    label: 'MCP onboarding',
    url: 'http://127.0.0.1:3004',
  },
] as const) {
  test(`${surface.label} reports no serious or critical violations`, async ({ page }) => {
    await page.goto(surface.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: surface.heading })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, surface.label);
  });
}

for (const status of publicSurfaceStatuses) {
  test(`publishes canonical, private, status-specific metadata for ${status}`, async ({
    journey,
    page,
  }) => {
    expect(journey.seed).toBe('public-surfaces');
    const duelId = `duel_public_${status}`;
    const response = await page.goto(`${appOrigin}/duel/${duelId}`);
    expect(response?.ok()).toBe(true);

    const canonicalUrl = `${canonicalAppOrigin}/duel/${duelId}`;
    const socialImageUrl = `${canonicalUrl}/social/${status}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonicalUrl);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonicalUrl);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      socialImageUrl,
    );
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
      'content',
      socialImageUrl,
    );

    const metadata = await page.locator('head').innerHTML();
    expect(metadata).not.toContain(privateFixtureEscrowAddress);
    expect(metadata).not.toContain(privateFixtureOpponentWallet);
    expect(metadata).not.toContain(privateFixtureWallet);
    expect(metadata).not.toContain(privateFixtureSignature);
  });
}

async function expectNoSeriousOrCriticalViolations(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(violations, formatViolations(surface, violations)).toEqual([]);
}

function formatViolations(surface: string, violations: AxeResults['violations']): string {
  if (violations.length === 0) return `${surface}: no serious or critical axe violations`;
  return [
    `${surface}: serious or critical axe violations`,
    ...violations.map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} — ${JSON.stringify(
          violation.nodes.map((node) => node.target),
        )}`,
    ),
  ].join('\n');
}
