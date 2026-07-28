import 'reflect-metadata';

import { describe, expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ListVerifiedGameActivityQuery } from './games-lobby.dto.js';

describe('verified game activity query', () => {
  test('accepts the bounded defaults and opaque cursor shape', async () => {
    const query = plainToInstance(ListVerifiedGameActivityQuery, {
      cursor: 'v1.eyJpZCI6ImR1ZWxfYWN0aXZpdHkwMDAwMDEifQ',
      limit: '50',
    });

    expect(await validate(query)).toEqual([]);
    expect(query.limit).toBe(50);
  });

  test('rejects unbounded limits and non-versioned cursors', async () => {
    for (const input of [
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { cursor: 'raw-duel-id' },
      { cursor: `v1.${'a'.repeat(481)}` },
    ]) {
      expect(await validate(plainToInstance(ListVerifiedGameActivityQuery, input))).not.toEqual([]);
    }
  });
});
