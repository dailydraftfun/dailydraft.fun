import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import CardStreakPage, { metadata } from './page';

describe('canonical Card Streak route', () => {
  test('publishes accurate no-index devnet metadata', () => {
    expect(metadata.title).toBe('Card Streak — DailyDraft Devnet');
    expect(metadata.description).toContain('deterministic four-card risk loop');
    expect(metadata.description).toContain('without a wallet, funds, custody, or settlement');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });

  test('opens directly on playable game state instead of a fixture walkthrough', () => {
    const html = renderToStaticMarkup(<CardStreakPage />);
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

    expect(html).toContain('Build the streak. Know when to leave.');
    expect(html).toContain('aria-label="Card Streak game"');
    expect(html).toContain('Continue streak');
    expect(html).toContain('End run');
    expect(html).toContain('No wallet. No funds. No custody.');
    expect(html).toContain('id="rules"');
    expect(source).toContain('<CardStreakGame');
    expect(source).not.toContain('GameModePreview');
    expect(source).not.toContain('GameRulesOverview');
  });
});
