import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrimaryNavigation } from './primary-navigation';

describe('primary navigation', () => {
  test('renders the leaderboard as the only desktop destination', () => {
    const markup = renderToStaticMarkup(
      <PrimaryNavigation className="desktop-navigation" leaderboardActive={false} />,
    );

    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).toContain('class="desktop-navigation"');
    expect(markup).toContain('href="/leaderboard"');
    expect(markup).not.toContain('href="/games"');
    expect(markup).not.toContain('Games');
  });

  test('renders the leaderboard as the only mobile destination', () => {
    const markup = renderToStaticMarkup(
      <PrimaryNavigation className="mobile-navigation" leaderboardActive mobile />,
    );

    expect(markup).toContain('aria-label="Mobile primary navigation"');
    expect(markup).toContain('nav-link justify-center');
    expect(markup).toContain('href="/leaderboard"');
    expect(markup).not.toContain('href="/games"');
    expect(markup).not.toContain('href="/overview"');
    expect(markup).not.toContain('Card Duels');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
