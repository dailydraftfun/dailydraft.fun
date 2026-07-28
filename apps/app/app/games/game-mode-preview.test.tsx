import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameModePreview } from './game-mode-preview';

describe('game mode preview', () => {
  test('resolves workspace runtimes from source in fresh app installs', () => {
    const source = readFileSync(new URL('./game-mode-preview.tsx', import.meta.url), 'utf8');
    const nextConfig = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');
    const contractsPackage = JSON.parse(
      readFileSync(new URL('../../../../packages/contracts/package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, Record<string, string>>;
    };
    const enginePackage = JSON.parse(
      readFileSync(new URL('../../../../packages/engine/package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, Record<string, string>>;
    };

    expect(source).toContain("from '@dailydraft/contracts/pull-rarity'");
    expect(source).toContain("from '../components/celebration'");
    expect(source.match(/<CelebrationOverlay\b/g)).toHaveLength(2);
    expect(source).not.toMatch(/from '@dailydraft\/contracts';/);
    expect(nextConfig).toContain(
      "transpilePackages: ['@dailydraft/contracts', '@dailydraft/engine']",
    );
    expect(contractsPackage.exports['./pull-rarity']?.import).toBe('./src/pull-rarity.ts');
    expect(enginePackage.exports['.']?.import).toBe('./src/index.ts');
  });

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
    expect(configure).toContain('data-game-rules="flip"');
    expect(configure.match(/<h1\b/g)).toHaveLength(1);
    expect(configure).toContain('Commercial + provider gated');
    expect(configure).toContain('href="#preview-lab"');
    expect(configure).toContain('Commit fixture draw');
    expect(committed).toContain('Fixture pool committed');
    expect(revealed).toContain('Charizard · Base Set');
    expect(revealed).toContain('data-choreography-beat="idle"');
    expect(revealed).toContain('data-choreography-rarity="rare"');
    expect(revealed).toContain('Skip reveal animation');
    expect(revealed).toContain('Review fixture receipt');
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
    expect(active).toContain('data-game-rules="crash"');
    expect(active).toContain('Architecture + policy gated');
    expect(active).toContain('Cash out fixture pot');
    expect(active).toContain('data-choreography-beat="settled"');
    expect(active).toContain('data-choreography-rarity="uncommon"');
    expect(active).toContain('data-choreography-settled="true"');
    expect(active).toContain('data-celebration-static="true"');
    expect(active).toContain('aria-hidden="true"');
    expect(active).toContain('Skip animation');
    expect(active).toContain('aria-disabled="true"');
    expect(active).not.toMatch(/<button[^>]*\sdisabled(?:=|>)/);
    expect(active).toContain('min-h-12');
    expect(active).toContain('text-xs');
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
    expect(ready).toContain('href="/games/duel"');
  });
});
