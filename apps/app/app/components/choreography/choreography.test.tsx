import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  type ChoreographyController,
  ChoreographyDriver,
  useRevealChoreography,
} from './choreography';

describe('reveal choreography React binding', () => {
  test('renders a Motion driver that advances only its completed beat', () => {
    const completed: string[] = [];
    const controller = controllerFor('anticipation', (beat) => completed.push(beat ?? 'missing'));
    const driver = ChoreographyDriver({ controller, sequenceKey: 'fixture' }) as ReactElement<{
      onAnimationComplete(): void;
    }>;

    expect(driver.key).toBe('fixture-anticipation');
    expect(driver.props).toMatchObject({
      animate: { scaleX: 1 },
      'aria-hidden': 'true',
      initial: { scaleX: 0 },
      transition: controller.transition,
    });

    driver.props.onAnimationComplete();
    expect(completed).toEqual(['anticipation']);
    expect(ChoreographyDriver({ controller: controllerFor('settled') })).toBeNull();
  });

  test('keeps the server-rendered binding inspectable before client effects begin', () => {
    const markup = renderToStaticMarkup(<BindingContract />);

    expect(markup).toContain('data-beat="settled"');
    expect(markup).toContain('data-rarity="rare"');
    expect(markup).toContain('data-revealed="true"');
    expect(markup).toContain('data-settled="true"');
    expect(markup).toContain('data-duration="0"');
  });

  test('provides a zero-motion CSS fallback with fluid 390px-safe sizing', () => {
    const css = readFileSync(new URL('./choreography.module.css', import.meta.url), 'utf8');

    expect(css).toContain('inline-size: min(100%, 15rem)');
    expect(css).toContain('max-inline-size: calc(100vw - 2rem)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*animation: none;/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*transition: none;/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*\.driver\s*\{[^}]*display: none;/s);
  });
});

function BindingContract() {
  const choreography = useRevealChoreography({
    active: true,
    initiallySettled: true,
    rarity: 'rare',
  });

  return (
    <div
      data-beat={choreography.beat}
      data-duration={choreography.transition.duration}
      data-rarity={choreography.rarity}
      data-revealed={choreography.revealed}
      data-settled={choreography.settled}
    />
  );
}

function controllerFor(
  beat: ChoreographyController['beat'],
  advance: ChoreographyController['advance'] = () => undefined,
): ChoreographyController {
  const settled = beat === 'settled';
  return {
    advance,
    beat,
    fastForward: () => undefined,
    intensity: 0.5,
    rarity: 'common',
    revealed: beat === 'reveal' || beat === 'celebrate' || settled,
    settled,
    transition: { duration: 0.34, ease: [0.2, 0.9, 0.3, 1] },
  };
}
