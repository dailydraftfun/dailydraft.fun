import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { holoCardRarities, holoCardRarityProfiles } from '../../components/holo-card';
import HoloCardPreviewPage, { metadata } from './page';

describe('holographic card preview contract', () => {
  test('publishes a no-index component lab', () => {
    expect(metadata.title).toBe('Holographic card component lab — DailyDraft');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });

  test('server-renders every rarity with its meaningful foil contract', () => {
    const markup = renderToStaticMarkup(<HoloCardPreviewPage />);

    expect(markup).toContain('Holographic card treatments');
    expect(markup).toContain('aria-label="Holographic card rarity previews"');

    for (const rarity of holoCardRarities) {
      const profile = holoCardRarityProfiles[rarity];

      expect(markup).toContain(`data-rarity="${rarity}"`);
      expect(markup).toContain(`data-foil-layers="${profile.foilLayers}"`);
      expect(markup).toContain(`data-treatment="${profile.treatment}"`);
      expect(markup).toContain(profile.label);
    }

    expect(markup).toContain('Pikachu · Base Set');
    expect(markup).toContain('Blastoise · Base Set');
    expect(markup).toContain('Mewtwo · Base Set');
    expect(markup).toContain('Charizard · Base Set');
    expect(markup).toContain('$18.50');
    expect(markup).toContain('$72.50');
  });
});
