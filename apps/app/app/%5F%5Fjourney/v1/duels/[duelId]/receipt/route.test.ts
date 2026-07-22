import { afterEach, describe, expect, test } from 'bun:test';

import { GET } from './route';

const originalFixtureFlag = process.env.NEXT_PUBLIC_E2E_FIXTURES;

afterEach(() => {
  if (originalFixtureFlag === undefined) {
    delete process.env.NEXT_PUBLIC_E2E_FIXTURES;
  } else {
    process.env.NEXT_PUBLIC_E2E_FIXTURES = originalFixtureFlag;
  }
});

function getReceipt(duelId: string): Promise<Response> {
  return GET(new Request(`http://localhost/__journey/v1/duels/${duelId}/receipt`), {
    params: Promise.resolve({ duelId }),
  });
}

describe('public journey receipt route', () => {
  test('is unavailable outside the explicit fixture environment', async () => {
    delete process.env.NEXT_PUBLIC_E2E_FIXTURES;

    expect((await getReceipt('duel_public_waiting')).status).toBe(404);
  });

  test('returns not found for unknown fixture receipts', async () => {
    process.env.NEXT_PUBLIC_E2E_FIXTURES = '1';

    expect((await getReceipt('unknown')).status).toBe(404);
  });

  test('returns the public-only receipt with defensive headers', async () => {
    process.env.NEXT_PUBLIC_E2E_FIXTURES = '1';

    const response = await getReceipt('duel_public_waiting');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.json()).toEqual(
      expect.objectContaining({
        duel: expect.objectContaining({ id: 'duel_public_waiting', status: 'waiting' }),
      }),
    );
  });
});
