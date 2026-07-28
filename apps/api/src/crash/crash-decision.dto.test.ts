import { describe, expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CrashPlayerDecisionRequest, CrashRoundParams } from './crash-decision.dto.js';

describe('Crash player decision DTOs', () => {
  test('accept canonical round parameters and both stage actions', async () => {
    await expect(
      validate(
        plainToInstance(CrashRoundParams, {
          roundId: 'crashround_fixture1234',
        }),
      ),
    ).resolves.toEqual([]);

    for (const action of ['continue', 'cash-out']) {
      await expect(
        validate(
          plainToInstance(CrashPlayerDecisionRequest, {
            action,
            expectedStage: 1,
            expectedVersion: 2,
          }),
        ),
      ).resolves.toEqual([]);
    }
  });

  test('rejects malformed ids, actions, stages, and versions', async () => {
    const invalid = await Promise.all([
      validate(plainToInstance(CrashRoundParams, { roundId: 'duel_not-crash' })),
      validate(
        plainToInstance(CrashPlayerDecisionRequest, {
          action: 'double',
          expectedStage: 0,
          expectedVersion: 1.5,
        }),
      ),
    ]);

    expect(invalid[0]?.length).toBeGreaterThan(0);
    expect(invalid[1]?.map(({ property }) => property).sort()).toEqual([
      'action',
      'expectedStage',
      'expectedVersion',
    ]);
  });
});
