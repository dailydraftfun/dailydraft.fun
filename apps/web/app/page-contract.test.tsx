import { describe, expect, test } from 'bun:test';
import { PUBLIC_GAME_TAXONOMY } from '@dailydraft/contracts/public-game-taxonomy';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from './page';

const markup = renderToStaticMarkup(<LandingPage />);

describe('landing page contract', () => {
  test('leads with the DailyDraft squad-building promise', () => {
    expect(markup).toContain('Own the cards.');
    expect(markup).toContain('Field the squad.');
    expect(markup).toContain('Sports fantasy casino on Solana');
    expect(markup).toContain('Collector Crypt');
    expect(markup).toContain('DAILYDRAFT');
  });

  test('explains the full rip-to-payout loop in order', () => {
    const steps = ['Rip a sports pack', 'Build your squad', 'Auto-enter tournaments'];
    const positions = steps.map((step) => markup.indexOf(step));

    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    expect(markup).toContain('Win on real match data');
    expect(markup).toContain('Squads lock at kickoff');
  });

  test('keeps the trust story and escrow evidence reachable', () => {
    expect(markup).toContain('Your wallet signs');
    expect(markup).toContain('Real cards, on-chain');
    expect(markup).toContain('Verifiable outcomes');
    expect(markup).toContain('https://github.com/dailydraftfun/escrow');
  });

  test('deep-links every game explanation to the canonical product rules', () => {
    expect(markup).toContain('Browse before the wallet');
    for (const mode of PUBLIC_GAME_TAXONOMY) {
      expect(markup).toContain(`href="https://app.dailydraft.fun${mode.rulesHref}"`);
      expect(markup).toContain(mode.name);
      expect(markup).toContain(mode.statusLabel);
    }
  });

  test('states the devnet limit and drops the pack-duel framing', () => {
    expect(markup).toContain('demo assets have no real-world value');
    expect(markup).not.toContain('Two packs');
    expect(markup).not.toContain('One winner');
    expect(markup).not.toContain('Pack Duel');
  });

  test('routes both primary calls to action at the product app, never back at this apex', () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.dailydraft.fun';

    expect(markup).toContain('Start playing');
    expect(markup).toContain('Play DailyDraft');
    expect(markup).toContain('Enter the arena');
    expect(markup).toContain(`href="${appUrl}"`);
    // The apex serves this marketing page and has no rewrite into the product app, so a CTA
    // pointing at it loops the visitor straight back here.
    expect(markup).not.toContain('href="https://dailydraft.fun"');
    expect(markup).toContain('href="#how-it-works"');
  });
});
