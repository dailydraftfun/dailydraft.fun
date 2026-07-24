import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from './page';

const markup = renderToStaticMarkup(<LandingPage />);

describe('landing page contract', () => {
  test('leads with the Grail squad-building promise', () => {
    expect(markup).toContain('Own the cards.');
    expect(markup).toContain('Field the squad.');
    expect(markup).toContain('Sports fantasy casino on Solana');
    expect(markup).toContain('Collector Crypt');
    expect(markup).toContain('GRAIL');
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
    expect(markup).toContain('https://github.com/openpacksduel/escrow');
  });

  test('states the devnet limit and drops the pack-duel framing', () => {
    expect(markup).toContain('demo assets have no real-world value');
    expect(markup).not.toContain('Two packs');
    expect(markup).not.toContain('One winner');
    expect(markup).not.toContain('Pack Duel');
  });

  test('routes both primary calls to action at the app', () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://openpacksduel.vercel.app';

    expect(markup).toContain('Start playing');
    expect(markup).toContain('Play Grail');
    expect(markup).toContain('Enter the arena');
    expect(markup).toContain(`href="${appUrl}"`);
    expect(markup).toContain('href="#how-it-works"');
  });
});
