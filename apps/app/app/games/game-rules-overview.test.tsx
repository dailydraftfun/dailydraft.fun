import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameRulesOverview } from './game-rules-overview';

describe('browse-first game rules overview', () => {
  test('renders the canonical rules landmark and state ledger for every mode', () => {
    for (const mode of ['duel', 'flip', 'crash'] as const) {
      const markup = renderToStaticMarkup(<GameRulesOverview mode={mode} />);

      expect(markup).toContain('id="rules"');
      expect(markup).toContain(`data-game-rules="${mode}"`);
      expect(markup).toContain('Know the outcome path');
      expect(markup.match(/<h1\b/g)).toHaveLength(1);
      expect(markup).toContain('Wallet requirement.');
      expect(markup).toContain('State ledger');
      expect(markup).toContain('Committed');
      expect(markup).toContain('Owned');
      expect(markup).toContain('Final');
      expect(markup).toContain('Exact promotion gates');
    }
  });

  test('routes only the live Duel surface toward runtime options', () => {
    const duel = renderToStaticMarkup(<GameRulesOverview mode="duel" />);
    const flip = renderToStaticMarkup(<GameRulesOverview mode="flip" />);
    const crash = renderToStaticMarkup(<GameRulesOverview mode="crash" />);

    expect(duel).toContain('href="#duel-lobby"');
    expect(duel).toContain('Check live duel options');
    for (const preview of [flip, crash]) {
      expect(preview).toContain('href="#preview-lab"');
      expect(preview).toContain('Run no-value fixture');
      expect(preview).not.toMatch(/>Connect wallet<|>Play now<|>Buy now</);
    }
  });

  test('keeps a 390px-first layout, visible focus target, and reduced-motion fallback', () => {
    const styles = readFileSync(
      new URL('./game-rules-overview.module.css', import.meta.url),
      'utf8',
    );
    const baseStyles = styles.split('@media (min-width: 760px)')[0] ?? styles;

    expect(styles).toContain('min-height: 44px');
    expect(styles).toContain('scroll-margin-top: 11rem');
    expect(styles).toContain('@media (min-width: 760px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none');
    expect(baseStyles).not.toMatch(/min-width:\s*(?:39[1-9]|[4-9]\d{2,})px/);
  });
});
