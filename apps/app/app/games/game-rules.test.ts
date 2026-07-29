import { describe, expect, test } from 'bun:test';
import { PUBLIC_GAME_TAXONOMY } from '@dailydraft/contracts/public-game-taxonomy';
import { canonicalRulesHref, type GameRulesMode, gameRules } from './game-rules';

const modes: GameRulesMode[] = PUBLIC_GAME_TAXONOMY.flatMap((mode) =>
  mode.id === 'gacha' ? [] : [mode.id],
);
const rulesModes = PUBLIC_GAME_TAXONOMY.filter((mode) => mode.id !== 'gacha');

describe('canonical game rules', () => {
  test('gives every established mode one canonical rules anchor', () => {
    expect(modes.map((mode) => canonicalRulesHref(mode))).toEqual(
      rulesModes.map((mode) => mode.rulesHref),
    );
    expect(new Set(modes.map((mode) => canonicalRulesHref(mode))).size).toBe(3);
    expect(modes.map((mode) => gameRules[mode].name)).toEqual(rulesModes.map((mode) => mode.name));
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
    const copy = JSON.stringify(gameRules.duel);
    expect(copy).toContain('tier is a pool label, not an amount charged');
    expect(copy).toContain('separately inspect and approve your exact test-SOL platform fee');
    expect(copy).toContain('only after both participants’ platform-fee transactions finalize');
    expect(copy).toContain('value is not charged or purchased');
    expect(copy).not.toContain('Two wallets fund the same enabled tier');
  });

  test('describes Flip as a fixed local script without selection proof', () => {
    const copy = JSON.stringify(gameRules.flip);

    expect(copy).toContain('fixed result');
    expect(copy).toContain('No pool snapshot, seed, commitment, or selection proof is created');
    expect(copy).toContain('no sealed pool, random draw, reproducible selection proof');
    expect(copy).not.toContain('sealed demonstration pool');
    expect(copy).not.toContain('reproducibly selected');
  });

  test('matches Crash to the fixed four-stage UI state machine', () => {
    const copy = JSON.stringify(gameRules.crash);

    expect(copy).toContain('four fixed card stages');
    expect(copy).toContain('attempt past the final stage');
    expect(copy).toContain('Only an attempt past the final stage triggers the scripted bust state');
    expect(copy).not.toContain('next committed fixture stage');
  });
});
