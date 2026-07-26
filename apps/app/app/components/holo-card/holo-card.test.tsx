import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { HoloCard } from './holo-card';
import { holoCardRarities, holoCardRarityProfiles } from './holo-card-rarity';

describe('holo card', () => {
  test('renders every local rarity variant with its foil treatment metadata', () => {
    for (const rarity of holoCardRarities) {
      const markup = renderToStaticMarkup(
        <HoloCard
          imageUrl="/fixtures/card.png"
          name={`${rarity} card`}
          rarity={rarity}
          value="$72.50"
        />,
      );

      expect(markup).toContain(`data-rarity="${rarity}"`);
      expect(markup).toContain(`data-foil-layers="${holoCardRarityProfiles[rarity].foilLayers}"`);
      expect(markup).toContain(`data-treatment="${holoCardRarityProfiles[rarity].treatment}"`);
      expect(markup).toContain(holoCardRarityProfiles[rarity].label);
      expect(markup).toContain(`${rarity} card`);
      expect(markup).toContain('tabindex="0"');
      expect(markup).toContain('role="img"');
    }
  });

  test('provides an equivalent keyboard highlight and a static rich reduced-motion fallback', () => {
    const css = readFileSync(new URL('./holo-card.module.css', import.meta.url), 'utf8');

    expect(css).toContain('.card:focus-visible');
    expect(css).toContain('outline: 3px solid var(--opd-accent)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/\.card,\s+\.card:focus-visible\s*\{[^}]*transform: none;/s);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*--holo-glare: 0\.42;/);
    expect(css).toContain('--holo-sheen-x: var(--holo-pointer-sheen-x)');
    expect(css).toContain('.card[data-settling="true"]');
    expect(css).toMatch(/\.stage\[data-rarity=["']chase["']\]/);
  });

  test('keeps the card identity in its accessible name when artwork detail is supplied', () => {
    const markup = renderToStaticMarkup(
      <HoloCard
        imageAlt="Rainbow holofoil artwork"
        imageUrl="/fixtures/card.png"
        name="Charizard · Base Set"
        rarity="chase"
      />,
    );

    expect(markup).toContain(
      'aria-label="Charizard · Base Set, Rainbow holofoil artwork, Chase foil holographic card"',
    );
  });

  test('keeps the card width fluid below the 390px viewport boundary', () => {
    const css = readFileSync(new URL('./holo-card.module.css', import.meta.url), 'utf8');

    expect(css).toContain('inline-size: min(100%, 20rem)');
    expect(css).toContain('max-inline-size: calc(100vw - 2rem)');
    expect(css).toContain('aspect-ratio: 5 / 7');
    expect(css).toContain('touch-action: pan-y');
  });
});
