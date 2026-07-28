import { describe, expect, test } from 'bun:test';
import { PUBLIC_GAME_TAXONOMY } from '@dailydraft/contracts/public-game-taxonomy';
import { integrationSafetyGuidance } from './server';

describe('MCP integration safety guidance', () => {
  test('sends agents to the same canonical rules surfaces as the product', () => {
    for (const mode of PUBLIC_GAME_TAXONOMY) {
      expect(integrationSafetyGuidance).toContain(
        `${mode.name}: https://app.dailydraft.fun${mode.rulesHref}${mode.runtime ? '' : ' (fixture only)'}`,
      );
    }
    expect(integrationSafetyGuidance).toContain(
      'Never present a fixture-only mode or unresolved tier as playable.',
    );
  });
});
