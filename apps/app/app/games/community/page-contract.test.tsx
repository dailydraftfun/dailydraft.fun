import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import CommunitySafetyPage, { metadata } from './page';

describe('community safety page contract', () => {
  test('keeps public chat visibly unavailable behind the moderation launch gate', () => {
    const markup = renderToStaticMarkup(<CommunitySafetyPage />);

    expect(markup).toContain('Public chat is unavailable.');
    expect(markup).toContain('data-chat-state="unavailable"');
    expect(markup).toContain('Default off · no transport');
    expect(markup).toContain('Required before launch');
    expect(markup).toContain('Age and terms gate');
    expect(markup).toContain('Report, block, and mute controls');
    expect(markup).toContain('Cooldown and self-exclusion enforcement');
    expect(markup).toContain('Rate limits and human escalation');
    expect(markup).toContain('Approved retention and audit logging');
    expect(markup).toContain('href="/games/activity"');
    expect(markup).toContain('href="/games"');
  });

  test('publishes no-index safety metadata', () => {
    expect(metadata.title).toBe('Community safety — DailyDraft Devnet');
    expect(metadata.description).toContain('public chat is unavailable');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });
});
