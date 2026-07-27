import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  GachaRevealFallback,
  GachaRevealScene,
  gachaRevealSceneMetadata,
} from './gacha-reveal-scene';

describe('gacha reveal scene binding', () => {
  test('server-renders a sealed pack without exposing the settled outcome while loading', () => {
    const html = renderToStaticMarkup(
      <GachaRevealScene
        cardImageUrl="https://images.pokemontcg.io/base1-4.png"
        displayName="Charizard Holo"
        rarity="rare"
        revealId="settled-rip-1"
      />,
    );

    expect(html).toContain('data-pixi-scene="sports-pack-gacha-reveal"');
    expect(html).toContain('data-pixi-status="fallback"');
    expect(html).toContain('data-fallback="gacha-reveal-dom"');
    expect(html).toContain('data-fallback-reason="loading"');
    expect(html).toContain('dailydraft-demo@1.0.0');
    expect(html).toContain('Sealed sports pack');
    expect(html).not.toContain('images.pokemontcg.io');
    expect(html).not.toContain('Charizard Holo');
    expect(html).not.toContain('<canvas');
  });

  test('renders the settled card for accessibility and renderer fallbacks', () => {
    const html = renderToStaticMarkup(
      <GachaRevealFallback
        cardImageUrl="https://images.pokemontcg.io/base1-4.png"
        descriptorId="gacha-reveal-dom"
        displayName="Charizard Holo"
        rarity="rare"
        reason="reduced-motion"
      />,
    );

    expect(html).toContain('data-fallback-reason="reduced-motion"');
    expect(html).toContain('images.pokemontcg.io');
    expect(html).toContain('Charizard Holo');
  });

  test('declares equivalent no-WebGL and reduced-motion outcomes', () => {
    expect(gachaRevealSceneMetadata.fallback.noWebGL.preserves).toEqual([
      'card identity',
      'card artwork',
      'committed rarity',
    ]);
    expect(gachaRevealSceneMetadata.fallback.reducedMotion.preserves).toEqual(
      gachaRevealSceneMetadata.fallback.noWebGL.preserves,
    );
  });
});
