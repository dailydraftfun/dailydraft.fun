import { describe, expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IngestProductEventsRequest } from './analytics.dto.js';

const SESSION = 'anon_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('analytics ingestion schema', () => {
  test('accepts only bounded client funnel fields', async () => {
    const input = plainToInstance(IngestProductEventsRequest, {
      events: [
        { mode: 'direct', name: 'duel_shared', status: 'waiting', tier: 50 },
        { name: 'wallet_authenticated' },
      ],
      sessionId: SESSION,
    });

    const errors = await validate(input, { forbidNonWhitelisted: true, whitelist: true });

    expect(errors).toHaveLength(0);
  });

  test('rejects forged lifecycle and operational events from public clients', async () => {
    for (const name of [
      'duel_created',
      'duel_matched',
      'duel_funded',
      'pack_revealed',
      'duel_settled',
      'solana_rpc_error',
    ]) {
      const input = plainToInstance(IngestProductEventsRequest, {
        events: [{ name }],
        sessionId: SESSION,
      });

      const errors = await validate(input, { forbidNonWhitelisted: true, whitelist: true });

      expect(errors.length).toBeGreaterThan(0);
    }
  });

  test('rejects server-only events and sensitive or free-form fields', async () => {
    const input = plainToInstance(IngestProductEventsRequest, {
      events: [
        {
          errorMessage: 'provider credential leaked',
          name: 'provider_error',
          signature: 'secret',
          token: 'secret',
          wallet: '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1',
        },
      ],
      sessionId: SESSION,
    });

    const errors = await validate(input, { forbidNonWhitelisted: true, whitelist: true });

    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain('name');
  });

  test('caps one request at twenty events', async () => {
    const input = plainToInstance(IngestProductEventsRequest, {
      events: Array.from({ length: 21 }, () => ({ name: 'lobby_viewed' })),
      sessionId: SESSION,
    });

    const errors = await validate(input, { forbidNonWhitelisted: true, whitelist: true });

    expect(errors.length).toBeGreaterThan(0);
  });
});
