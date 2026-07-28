import { expect, test } from './fixtures/playwright';

test.use({ journeySeed: 'chat-safety' });

test('public chat remains unavailable with a verified-activity fallback', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('chat-safety');

  await page.goto('/games/community');

  await expect(page.getByRole('heading', { name: 'Public chat is unavailable.' })).toBeVisible();
  await expect(page.locator('[data-chat-state="unavailable"]')).toContainText(
    'Default off · no transport',
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /send|submit|post/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View verified activity' })).toHaveAttribute(
    'href',
    '/games/activity',
  );
});

test('launch criteria name every required safety dependency', async ({ journey, page }) => {
  expect(journey.seed).toBe('chat-safety');

  await page.goto('/games/community');

  const contract = page.getByRole('region', { name: 'Required before launch' });
  await expect(contract).toContainText('Age and terms gate');
  await expect(contract).toContainText('Report, block, and mute controls');
  await expect(contract).toContainText('Cooldown and self-exclusion enforcement');
  await expect(contract).toContainText('Rate limits and human escalation');
  await expect(contract).toContainText('Approved retention and audit logging');
});
