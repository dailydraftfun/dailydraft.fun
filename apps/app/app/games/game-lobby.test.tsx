import { describe, expect, test } from 'bun:test';
import { GAME_CATALOG_SCHEMA_VERSION, type GameCatalog } from '@dailydraft/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameLobby } from './game-lobby';

describe('game lobby', () => {
  test('presents one dominant live arena and an honest gated roadmap', () => {
    const markup = renderToStaticMarkup(<GameLobby initialCatalog={catalog()} />);

    expect(markup).toContain('Playable now');
    expect(markup).toContain('Card Duel');
    expect(markup).toContain('Marketplace Flip');
    expect(markup).toContain('Card Streak');
    expect(markup).toContain('Sports Pack Gacha');
    expect(markup).toContain('Honest roadmap');
    expect(markup).toContain('Verified recent activity');
    expect(markup).toContain('Settled proof only');
    expect(markup).toContain('href="/games/activity"');
    expect(markup).toContain('Fixture preview');
    expect(markup).toContain('Jul 27 · 20:00 UTC');
    expect(markup).not.toContain('Fantasy Tournaments');
  });

  test('uses only canonical game routes and keeps House inside Duel', () => {
    const markup = renderToStaticMarkup(<GameLobby initialCatalog={catalog()} />);

    expect(markup).toContain('href="/games/duel"');
    expect(markup).toContain('href="/games/gacha"');
    expect(markup).toContain('href="/games/marketplace-flip#rules"');
    expect(markup).not.toContain('href="/games/flip"');
    expect(markup).toContain('href="/games/crash#rules"');
    expect(markup).toContain('href="/games/duel#rules"');
    expect(markup).toContain('Play the house');
    expect(markup).not.toContain('href="/overview"');
    expect(markup).not.toContain('href="/games/house"');
  });

  test('shows no runtime action while capability state is loading', () => {
    const markup = renderToStaticMarkup(<GameLobby />);

    expect(markup).toContain('No unverified play.');
    expect(markup).toContain('Live actions withheld');
    expect(markup).not.toContain('Challenge a wallet');
    expect(markup).not.toContain('Rip a sports pack');
  });

  test('makes fixture and devnet limitations explicit without fake activity', () => {
    const markup = renderToStaticMarkup(<GameLobby initialCatalog={catalog()} />);

    expect(markup).toContain('Fixture preview');
    expect(markup).toContain('Devnet · test assets only');
    expect(markup).toContain('No fake activity');
    expect(markup).not.toContain('players online');
    expect(markup).not.toContain('live pot');
  });

  test('distinguishes a runtime-gated game from a fixture preview', () => {
    const input = catalog();
    input.modes = input.modes.map((mode) =>
      mode.id === 'duel'
        ? {
            ...mode,
            availableActions: [],
            reason: 'Acquisition and settlement remain gated.',
            state: 'preview',
          }
        : mode,
    );

    const markup = renderToStaticMarkup(<GameLobby initialCatalog={input} />);

    expect(markup).toContain('Capability gated');
    expect(markup).toContain('Fixture preview');
  });

  test('renders deterministic catalog timestamps and fails malformed evidence closed', () => {
    const epochCatalog = catalog();
    epochCatalog.asOf = new Date(0).toISOString();
    expect(renderToStaticMarkup(<GameLobby initialCatalog={epochCatalog} />)).toContain(
      'Verified not yet',
    );

    const malformedCatalog = catalog();
    malformedCatalog.asOf = 'not-a-date';
    expect(renderToStaticMarkup(<GameLobby initialCatalog={malformedCatalog} />)).toContain(
      'Verified unknown',
    );
  });
});

function catalog(): GameCatalog {
  return {
    asOf: '2026-07-27T20:00:00.000Z',
    modes: [
      {
        availableActions: [
          { href: '/games/duel', id: 'direct-challenge', label: 'Challenge a wallet' },
          { href: '/games/duel', id: 'open-matchmaking', label: 'Find a rival' },
          { href: '/games/duel', id: 'house-opponent', label: 'Play the house' },
        ],
        capabilitySource: {
          kind: 'runtime',
          name: 'duel-readiness',
          status: 'verified',
        },
        description: 'Open matching packs.',
        id: 'duel',
        name: 'Card Duel',
        reason: 'Direct challenges and open matchmaking are ready on Solana devnet.',
        state: 'playable',
      },
      {
        availableActions: [{ href: '/games/gacha', id: 'rip-pack', label: 'Rip a sports pack' }],
        capabilitySource: {
          kind: 'runtime',
          name: 'gacha-capability',
          status: 'verified',
        },
        description: 'Rip from a sealed pool.',
        id: 'gacha',
        name: 'Sports Pack Gacha',
        reason: 'Provider, odds, acquisition, and settlement gates are ready.',
        state: 'playable',
      },
      {
        availableActions: [
          {
            href: '/games/marketplace-flip',
            id: 'view-preview',
            label: 'View fixture preview',
          },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Trade a committed quote.',
        id: 'flip',
        name: 'Marketplace Flip',
        reason: 'Fixture preview only.',
        state: 'preview',
      },
      {
        availableActions: [
          { href: '/games/crash', id: 'view-preview', label: 'View fixture preview' },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Build a card streak.',
        id: 'crash',
        name: 'Card Streak',
        reason: 'Fixture preview only.',
        state: 'preview',
      },
    ],
    network: 'solana-devnet',
    schemaVersion: GAME_CATALOG_SCHEMA_VERSION,
  };
}
