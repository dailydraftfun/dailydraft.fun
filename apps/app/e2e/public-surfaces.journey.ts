import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import {
  privateFixtureSignature,
  privateFixtureWallet,
  publicSurfaceStatuses,
} from '../app/__journey/public-duel-receipt';
import { journeyTestIds } from '../app/e2e/journey-test-ids';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const appOrigin = 'http://127.0.0.1:3001';
const canonicalAppOrigin = 'https://openpacksduel.vercel.app';
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;

test.use({ journeySeed: 'public-surfaces' });

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

  await page.getByTestId(journeyTestIds.walletMenu).click();
  await page.getByTestId(journeyTestIds.walletOption).click();
  await page.getByTestId(journeyTestIds.walletMenu).click();
  await page.getByTestId(journeyTestIds.walletAuthenticationPrepare).click();
  await expect(page.getByTestId(journeyTestIds.walletAuthenticationSign)).toBeVisible();
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
  await expectNoSeriousOrCriticalViolations(page, 'transaction review');

  await page.getByTestId('duel-entry-confirm-funding').click();
  await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
  await expect(page.getByLabel('Reveal progress')).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page, 'reveal');

  await expect(page.getByTestId(journeyTestIds.resultMargin)).toBeVisible({ timeout: 15_000 });
  await expectNoSeriousOrCriticalViolations(page, 'result');

  await page.getByRole('link', { name: 'Verified receipt' }).click();
  await expect(page.getByRole('heading', { name: /won the vault/i })).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page, 'receipt');
});

for (const surface of [
  {
    heading: /two packs/i,
    label: 'marketing',
    url: 'http://127.0.0.1:3000',
  },
  {
    heading: /build on the duel protocol/i,
    label: 'docs',
    url: 'http://127.0.0.1:3002',
  },
  {
    heading: /openpacks duel mcp/i,
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
  test(
    `publishes canonical, private, status-specific metadata for ${status}`,
    async ({ journey, page }) => {
      expect(journey.seed).toBe('public-surfaces');
      const duelId = `duel_public_${status}`;
      const response = await page.goto(`${appOrigin}/duel/${duelId}`);
      expect(response?.ok()).toBe(true);

      const canonicalUrl = `${canonicalAppOrigin}/duel/${duelId}`;
      const socialImageUrl = `${canonicalUrl}/social/${status}`;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonicalUrl);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        'content',
        canonicalUrl,
      );
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        'content',
        socialImageUrl,
      );
      await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
        'content',
        socialImageUrl,
      );

      const metadata = await page.locator('head').innerHTML();
      expect(metadata).not.toContain(privateFixtureWallet);
      expect(metadata).not.toContain(privateFixtureSignature);
    },
  );
}

async function expectNoSeriousOrCriticalViolations(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(violations, formatViolations(surface, violations)).toEqual([]);
}

function formatViolations(
  surface: string,
  violations: AxeResults['violations'],
): string {
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
