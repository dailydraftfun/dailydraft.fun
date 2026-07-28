import { describe, expect, test } from 'bun:test';
import { integrationSafetyGuidance } from './server';

describe('MCP integration safety guidance', () => {
  test('sends agents to the same canonical rules surfaces as the product', () => {
    expect(integrationSafetyGuidance).toContain('https://app.dailydraft.fun/games/duel#rules');
    expect(integrationSafetyGuidance).toContain(
      'https://app.dailydraft.fun/games/marketplace-flip#rules (fixture only)',
    );
    expect(integrationSafetyGuidance).toContain(
      'https://app.dailydraft.fun/games/crash#rules (fixture only)',
    );
    expect(integrationSafetyGuidance).toContain(
      'Never present a fixture-only mode or unresolved tier as playable.',
    );
  });
});
