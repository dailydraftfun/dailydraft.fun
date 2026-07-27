import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrimaryNavigation } from './primary-navigation';

describe('primary navigation', () => {
  test('marks Games as the active desktop destination', () => {
    const markup = renderToStaticMarkup(
      <PrimaryNavigation className="desktop-navigation" gamesActive leaderboardActive={false} />,
    );

    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).toContain('class="desktop-navigation"');
    expect(markup).toContain('href="/games"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('nav-link-active');
    expect(markup).toContain('Games');
  });

  test('renders the mobile layout with one Games destination and the leaderboard', () => {
    const markup = renderToStaticMarkup(
      <PrimaryNavigation
        className="mobile-navigation"
        gamesActive
        leaderboardActive={false}
        mobile
      />,
    );

    expect(markup).toContain('aria-label="Mobile primary navigation"');
    expect(markup).toContain('nav-link justify-center');
    expect(markup).toContain('href="/games"');
    expect(markup).toContain('href="/leaderboard"');
    expect(markup).not.toContain('href="/overview"');
    expect(markup).not.toContain('Card Duels');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
