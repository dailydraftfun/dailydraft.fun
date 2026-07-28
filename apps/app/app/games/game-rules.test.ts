import { describe, expect, test } from 'bun:test';
import { canonicalRulesHref, type GameRulesMode, gameRules } from './game-rules';

const modes: GameRulesMode[] = ['duel', 'flip', 'crash'];

describe('canonical game rules', () => {
  test('gives every established mode one canonical rules anchor', () => {
    expect(modes.map((mode) => canonicalRulesHref(mode))).toEqual([
      '/games/duel#rules',
      '/games/marketplace-flip#rules',
      '/games/crash#rules',
    ]);
    expect(new Set(modes.map((mode) => canonicalRulesHref(mode))).size).toBe(3);
  });

  test('publishes the complete player-language contract for every mode', () => {
    for (const mode of modes) {
      const rules = gameRules[mode];

      expect(rules.loop).toHaveLength(4);
      expect(rules.facts.map((fact) => fact.label)).toContain('Eligibility');
      expect(rules.custody.length).toBeGreaterThan(40);
      expect(rules.settlement.length).toBeGreaterThan(40);
      expect(rules.refund.length).toBeGreaterThan(40);
      expect(rules.receipt.length).toBeGreaterThan(40);
      expect(rules.wallet.length).toBeGreaterThan(40);
      expect(rules.gates.length).toBeGreaterThanOrEqual(4);
      expect(rules.stateLegend.map((fact) => fact.label)).toEqual(['Committed', 'Owned', 'Final']);
    }
  });

  test('keeps unresolved modes fixture-only without invented wallet or value actions', () => {
    for (const mode of ['flip', 'crash'] as const) {
      const rules = gameRules[mode];
      const copy = JSON.stringify(rules);

      expect(rules.state).toBe('fixture-preview');
      expect(rules.previewHref).toBe('#preview-lab');
      expect(rules.previewLabel).toBe('Run no-value fixture');
      expect(copy).toContain('No wallet is needed');
      expect(copy).toContain('nothing to refund');
      expect(copy).not.toMatch(/connect wallet|buy now|play for|cash out \$|approve \$/i);
    }
  });

  test('states the exact Duel wallet boundary before the runtime action', () => {
    expect(gameRules.duel.state).toBe('devnet-runtime');
    expect(gameRules.duel.previewHref).toBe('#duel-lobby');
    expect(gameRules.duel.wallet).toContain('Browsing needs no wallet');
    expect(gameRules.duel.wallet).toContain('no-value ownership message');
    expect(gameRules.duel.wallet).toContain('exact displayed test-SOL transaction');
  });
});
