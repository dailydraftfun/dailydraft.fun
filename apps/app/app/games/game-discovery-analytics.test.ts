import { describe, expect, test } from 'bun:test';

import { buildGameDiscoveryEvent } from './game-discovery-analytics';

describe('game discovery analytics', () => {
  test('emits only bounded public taxonomy and opaque activity fields', () => {
    const event = buildGameDiscoveryEvent({
      actionId: 'Run A Rematch',
      activityId: 'duel:duel_activity000001',
      mode: 'duel',
      stage: 'rematch',
    });
    const serialized = JSON.stringify(event);

    expect(event).toEqual({
      actionId: 'invalid-action',
      activityRef: expect.stringMatching(/^act_[a-f0-9]{8}$/),
      mode: 'duel',
      schemaVersion: 'dailydraft.game-discovery.v1',
      stage: 'rematch',
    });
    expect(serialized).not.toContain('duel_activity000001');
    expect(serialized).not.toContain('wallet');
    expect(serialized).not.toContain('participant');
  });

  test('normalizes a safe action id and omits absent identifiers', () => {
    expect(
      buildGameDiscoveryEvent({
        actionId: 'view-result',
        stage: 'result-view',
      }),
    ).toEqual({
      actionId: 'view-result',
      schemaVersion: 'dailydraft.game-discovery.v1',
      stage: 'result-view',
    });
  });
});
