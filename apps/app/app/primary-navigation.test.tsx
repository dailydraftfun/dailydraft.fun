import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrimaryNavigation } from './primary-navigation';

describe('primary navigation', () => {
  test('marks Games as the active desktop destination', () => {
    const markup = renderToStaticMarkup(
      <PrimaryNavigation
        className="desktop-navigation"
        duelActive={false}
        gamesActive
        leaderboardActive={false}
      />,
    );

    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).toContain('class="desktop-navigation"');
    expect(markup).toContain('href="/games"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('nav-link-active');
    expect(markup).toContain('Games');
  });

  test('renders the mobile layout and every destination', () => {
    const markup = renderToStaticMarkup(
      <PrimaryNavigation
        className="mobile-navigation"
        duelActive
        gamesActive={false}
        leaderboardActive
        mobile
      />,
    );

    expect(markup).toContain('aria-label="Mobile primary navigation"');
    expect(markup).toContain('nav-link justify-center');
    expect(markup).toContain('href="/games"');
    expect(markup).toContain('href="/overview"');
    expect(markup).toContain('href="/leaderboard"');
  });
});
