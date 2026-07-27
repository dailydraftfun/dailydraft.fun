import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FlipCapabilities } from '../game-catalog';

const { default: FlipPage, generateMetadata, resolveFlipSurface } = await import('./page');

const OPEN: FlipCapabilities = {
  acquisition: true,
  odds: true,
  provider: true,
  settlement: true,
};

describe('flip route metadata', () => {
  test('publishes the live title and keeps the devnet surface out of search', () => {
    const metadata = generateMetadata();

    expect(metadata.title).toBe('Sports Pack Gacha — DailyDraft Devnet');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });
});

describe('flip surface resolution', () => {
  test('mounts the live machine only when every build-time gate is open', () => {
    expect(resolveFlipSurface(OPEN)).toBe('live');
  });

  test('falls back to the preview when any single gate is shut', () => {
    for (const gate of ['acquisition', 'odds', 'provider', 'settlement'] as const) {
      expect(resolveFlipSurface({ ...OPEN, [gate]: false })).toBe('preview');
    }
  });
});

describe('flip page render', () => {
  test('renders a surface without throwing under the ambient provider mode', () => {
    // `NEXT_PUBLIC_PROVIDER_MODE` is substituted textually at build time and
    // cannot be reassigned from a test, so this asserts the route renders on
    // whichever branch the ambient config selects. The branch choice itself is
    // covered by `resolveFlipSurface` above, which is why it is exported.
    const markup = renderToStaticMarkup(FlipPage());

    expect(markup).toContain('<main');
    expect(markup.length).toBeGreaterThan(0);
  });
});
