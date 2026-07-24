import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameModePreview } from './game-mode-preview';

describe('game mode preview', () => {
  test('renders the complete Flip fixture journey', () => {
    const configure = renderToStaticMarkup(<GameModePreview mode="flip" />);
    const committed = renderToStaticMarkup(
      <GameModePreview fixtureState={{ flipStep: 1 }} mode="flip" />,
    );
    const revealed = renderToStaticMarkup(
      <GameModePreview fixtureState={{ flipStep: 2 }} mode="flip" />,
    );
    const receipt = renderToStaticMarkup(
      <GameModePreview fixtureState={{ flipStep: 3 }} mode="flip" />,
    );

    expect(configure).toContain('Choose one eligible inventory band');
    expect(configure).toContain('Commit fixture draw');
    expect(committed).toContain('Fixture pool committed');
    expect(revealed).toContain('Charizard · Base Set');
    expect(receipt).toContain('Flip acquisition receipt');
    expect(receipt).toContain('Not transferred');
  });

  test('renders active, cashed, and busted Crash states', () => {
    const active = renderToStaticMarkup(<GameModePreview mode="crash" />);
    const cashed = renderToStaticMarkup(
      <GameModePreview fixtureState={{ crashStage: 3, crashStatus: 'cashed' }} mode="crash" />,
    );
    const busted = renderToStaticMarkup(
      <GameModePreview fixtureState={{ crashStage: 4, crashStatus: 'busted' }} mode="crash" />,
    );

    expect(active).toContain('Continue fixture run');
    expect(active).toContain('Cash out fixture pot');
    expect(cashed).toContain('Fixture pot cashed out');
    expect(cashed).toContain('Player cash-out');
    expect(busted).toContain('committed stage busted');
    expect(busted).toContain('Committed bust');
  });

  test('renders House disclosure, precommitment, and ready states', () => {
    const disclosure = renderToStaticMarkup(<GameModePreview mode="house" />);
    const committed = renderToStaticMarkup(
      <GameModePreview fixtureState={{ houseStep: 1 }} mode="house" />,
    );
    const ready = renderToStaticMarkup(
      <GameModePreview fixtureState={{ houseStep: 2 }} mode="house" />,
    );

    expect(disclosure).toContain('The house follows the same duel contract');
    expect(disclosure).toContain('Accept fixture disclosure');
    expect(committed).toContain('house-fixture-9ae2');
    expect(ready).toContain('Admission contract accepted');
    expect(ready).toContain('href="/overview"');
  });
});
