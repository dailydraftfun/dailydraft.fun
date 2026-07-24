import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameLobby } from './game-lobby';

describe('game lobby', () => {
  test('presents the Duels, Gacha, Tournaments, and Streak lineup', () => {
    const markup = renderToStaticMarkup(<GameLobby />);

    expect(markup).toContain('Four sports loops.');
    expect(markup).toContain('Card Duels');
    expect(markup).toContain('Sports Pack Gacha');
    expect(markup).toContain('Fantasy Tournaments');
    expect(markup).toContain('Card Streak');
  });

  test('offers a real action only for the playable mode', () => {
    const markup = renderToStaticMarkup(<GameLobby />);

    expect(markup).toContain('href="/overview"');
    expect(markup).toContain('Enter duel arena');
    expect(markup).toContain('Collector Crypt gate pending');
    expect(markup).toContain('Match-data gate pending');
    expect(markup).toContain('Rules gate pending');
    expect(markup).toContain('href="/games/flip"');
    expect(markup).toContain('href="/games/crash"');
    expect(markup).toContain('Full UX test lab');
    expect(markup).not.toContain('href="/flip"');
    expect(markup).not.toContain('href="/crash"');
  });

  test('omits the preview link for a mode that has no fixture route', () => {
    const markup = renderToStaticMarkup(<GameLobby />);

    // Fantasy Tournaments carries no detailsHref, so the card must render its
    // gate status without a preview link that would resolve to a 404.
    expect(markup).toContain('Fantasy Tournaments');
    expect(markup).not.toContain('Open Fantasy Tournaments UX preview');
    expect(markup).not.toContain('href="/games/tournaments"');
  });

  test('keeps devnet and finality limits visible in the page contract', () => {
    const markup = renderToStaticMarkup(<GameLobby />);

    expect(markup).toContain('Devnet · test assets only');
    expect(markup).toContain('commits its rules before play');
    expect(markup).toContain('durable receipt');
    expect(markup).toContain('role="status"');
  });
});
