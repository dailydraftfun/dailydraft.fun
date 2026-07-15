import { describe, expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { EmergencyPauseRequest } from './admin.dto.js';

describe('emergency pause schema', () => {
  test('accepts bounded reason codes only', async () => {
    const valid = plainToInstance(EmergencyPauseRequest, {
      paused: true,
      reasonCode: 'provider_degraded',
    });
    const invalid = plainToInstance(EmergencyPauseRequest, {
      apiKey: 'must-not-be-audited',
      paused: true,
      reasonCode: 'because I said so',
    });

    expect(await validate(valid, { forbidNonWhitelisted: true, whitelist: true })).toHaveLength(0);
    expect(
      (await validate(invalid, { forbidNonWhitelisted: true, whitelist: true })).length,
    ).toBeGreaterThan(0);
  });
});
