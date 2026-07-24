import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameLobby } from './game-lobby';

describe('game lobby', () => {
  test('presents the established Duels, Flip, and Crash lineup', () => {
    const markup = renderToStaticMarkup(<GameLobby />);

    expect(markup).toContain('Three card loops');
    expect(markup).toContain('Duels');
    expect(markup).toContain('Flip Gacha');
    expect(markup).toContain('Crash');
  });

  test('offers a real action only for the playable mode', () => {
    const markup = renderToStaticMarkup(<GameLobby />);

    expect(markup).toContain('href="/overview"');
    expect(markup).toContain('Enter duel arena');
    expect(markup).toContain('Provider gate pending');
    expect(markup).toContain('Rules gate pending');
    expect(markup).toContain('href="/games/flip"');
    expect(markup).toContain('href="/games/crash"');
    expect(markup).toContain('Full UX test lab');
    expect(markup).not.toContain('href="/flip"');
    expect(markup).not.toContain('href="/crash"');
  });

  test('keeps devnet and finality limits visible in the page contract', () => {
    const markup = renderToStaticMarkup(<GameLobby />);

    expect(markup).toContain('Devnet · test assets only');
    expect(markup).toContain('commits its rules before play');
    expect(markup).toContain('durable receipt');
    expect(markup).toContain('role="status"');
  });
});
