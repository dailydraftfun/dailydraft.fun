import { describe, expect, mock, test } from 'bun:test';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// next/og rasterises through satori and a wasm renderer, which is far heavier than this
// contract needs. Capturing the element it is handed keeps the card's copy under test.
const captured: { element?: ReactElement; options?: { height: number; width: number } } = {};

mock.module('next/og', () => ({
  ImageResponse: class {
    constructor(element: ReactElement, options: { height: number; width: number }) {
      captured.element = element;
      captured.options = options;
    }
  },
}));

const { alt, contentType, default: OpenGraphImage, size } = await import('./opengraph-image');

OpenGraphImage();

const markup = renderToStaticMarkup(captured.element as ReactElement);

describe('marketing open graph card', () => {
  test('publishes the rebranded alt text at the standard card size', () => {
    expect(alt).toBe('DailyDraft — Own the cards. Field the squad.');
    expect(contentType).toBe('image/png');
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(captured.options).toEqual(size);
  });

  test('leads with the sports fantasy positioning rather than pack duels', () => {
    expect(markup).toContain('SPORTS FANTASY CASINO ON SOLANA');
    expect(markup).toContain('Own the cards.');
    expect(markup).toContain('Win the game.');
    expect(markup).toContain('Real vaulted cards. Live match data. Powered by Collector Crypt.');
    expect(markup).not.toContain('Two packs');
  });

  test('shows one graded card per sport, fanned in opposite directions', () => {
    expect(markup).toContain('FOOTBALL');
    expect(markup).toContain('HOOPS');
    expect(markup.match(/GRADED/g)).toHaveLength(2);
    expect(markup.match(/\$100/g)).toHaveLength(2);
    expect(markup).toContain('rotate(-6deg)');
    expect(markup).toContain('rotate(6deg)');
  });
});
