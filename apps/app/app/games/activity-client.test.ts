import { describe, expect, test } from 'bun:test';
import {
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivity,
  type VerifiedGameActivityPage,
  verifiedGameActivityContractFixtures,
} from '@dailydraft/contracts';
import {
  ActivityApiUnavailableError,
  getVerifiedGameActivity,
  parseVerifiedGameActivityPage,
  readCachedVerifiedGameActivity,
  resolveActivityApiHref,
  writeCachedVerifiedGameActivity,
} from './activity-client';

describe('verified activity client', () => {
  test('loads a bounded no-store projection and validates the response', async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const page = activityPage();
    const result = await getVerifiedGameActivity(
      100,
      'https://api.dailydraft.fun/v1',
      (input, init) => {
        requests.push({ init, url: String(input) });
        return Promise.resolve(Response.json(page));
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.dailydraft.fun/v1/games/activity?limit=50');
    expect(requests[0]?.init).toMatchObject({ cache: 'no-store' });
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual(page);
  });

  test('fails closed for an unconfigured or failed projection API', async () => {
    await expect(getVerifiedGameActivity(3, undefined)).rejects.toBeInstanceOf(
      ActivityApiUnavailableError,
    );

    let requestedUrl = '';
    await expect(
      getVerifiedGameActivity(Number.NaN, 'https://api.dailydraft.fun/v1', (input) => {
        requestedUrl = String(input);
        return Promise.resolve(new Response(null, { status: 503 }));
      }),
    ).rejects.toThrow('Verified activity is unavailable (503)');
    expect(requestedUrl).toEndWith('/games/activity?limit=6');
  });

  test('reconstructs the public envelope and drops unapproved extra properties', () => {
    const page = activityPage();
    const parsed = parseVerifiedGameActivityPage({
      ...page,
      rawWallet: '9xQeWvG816bUx9EPfEzF3F7PVhZVW5R1N9gJ1',
      data: page.data.map((activity) => ({ ...activity, privateMatchState: 'settling' })),
    });

    expect(parsed).toEqual(page);
    expect(JSON.stringify(parsed)).not.toContain('rawWallet');
    expect(JSON.stringify(parsed)).not.toContain('privateMatchState');
  });

  test('accepts generic one- and two-player envelopes in canonical order', () => {
    const page = activityPage([
      verifiedGameActivityContractFixtures.duel,
      verifiedGameActivityContractFixtures.flip,
      verifiedGameActivityContractFixtures.crash,
    ]);
    expect(parseVerifiedGameActivityPage(page)).toEqual(page);

    const occurredAt = '2026-07-28T11:59:00.000Z';
    const tiedModes = activityPage([
      { ...verifiedGameActivityContractFixtures.crash, occurredAt },
      duelActivity('z-round', occurredAt),
      duelActivity('a-round', occurredAt),
      { ...verifiedGameActivityContractFixtures.flip, occurredAt },
    ]);
    expect(parseVerifiedGameActivityPage(tiedModes)).toEqual(tiedModes);
  });

  test('rejects malformed page metadata before reading activity rows', () => {
    const page = activityPage();
    for (const invalid of [
      null,
      { ...page, schemaVersion: 'future' },
      { ...page, asOf: 123 },
      { ...page, asOf: '2026-07-28T12:00:00Z' },
      { ...page, data: 'activity' },
      { ...page, data: Array.from({ length: 51 }, () => page.data[0]) },
      { ...page, hasMore: 'false' },
      { ...page, nextCursor: 'invalid' },
    ]) {
      expect(() => parseVerifiedGameActivityPage(invalid)).toThrow('malformed verified activity');
    }
  });

  test('rejects direct or embedded wallet identifiers and participant shape drift', () => {
    const duel = verifiedGameActivityContractFixtures.duel;
    const invalidParticipants = [
      [{ label: '9xQeWvG816bUx9EPfEzF3F7PVhZVW5R1N9gJ1', role: 'player' }],
      [{ label: '9xQe…9gJ1', role: 'player' }],
      [null, null],
      [
        { label: 42, role: 'player' },
        { label: 'Gk8Z…MQyW', role: 'player' },
      ],
      [
        { label: '9xQe…9gJ1', role: 'spectator' },
        { label: 'Gk8Z…MQyW', role: 'player' },
      ],
      [
        { label: 'DailyDraft House', role: 'player' },
        { label: 'Gk8Z…MQyW', role: 'player' },
      ],
    ];
    for (const participants of invalidParticipants) {
      expect(() =>
        parseVerifiedGameActivityPage(
          activityPage([{ ...duel, participants } as unknown as VerifiedGameActivity]),
        ),
      ).toThrow('malformed verified activity');
    }

    expect(() =>
      parseVerifiedGameActivityPage(
        activityPage([
          {
            ...duel,
            resultSummary: '9xQeWvG816bUx9EPfEzF3F7PVhZVW5R1N9gJ1 won a verified Sports Pack Duel.',
          },
        ]),
      ),
    ).toThrow('malformed verified activity');
  });

  test('rejects mismatched identities, proof links, ordering, and money', () => {
    const duel = verifiedGameActivityContractFixtures.duel;
    const invalidPages = [
      activityPage([null as unknown as VerifiedGameActivity]),
      activityPage([{ ...duel, mode: 'gacha' } as unknown as VerifiedGameActivity]),
      activityPage([{ ...duel, activityId: 'duel:' }]),
      activityPage([{ ...duel, resultHref: '/v1/rgs/rounds/duel/another-round/proof' }]),
      activityPage([duel, duel]),
      activityPage([
        duelActivity('older', '2026-07-28T11:00:00.000Z'),
        duelActivity('newer', '2026-07-28T12:00:00.000Z'),
      ]),
      activityPage([{ ...duel, tier: { ...duel.tier, amount: '-1' } }]),
      activityPage([
        {
          ...duel,
          tier: { ...duel.tier, currency: 'USD' },
        } as unknown as VerifiedGameActivity,
      ]),
      activityPage([{ ...duel, occurredAt: 'not-a-date' }]),
    ];

    for (const invalid of invalidPages) {
      expect(() => parseVerifiedGameActivityPage(invalid)).toThrow('malformed verified activity');
    }
  });

  test('uses only validated cached snapshots and tolerates denied storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const page = activityPage();

    writeCachedVerifiedGameActivity(page, storage);
    expect(readCachedVerifiedGameActivity(storage)).toEqual(page);
    values.set('dailydraft.verified-game-activity.v1', '{"data":"invalid"}');
    expect(readCachedVerifiedGameActivity(storage)).toBeNull();
    expect(readCachedVerifiedGameActivity({ getItem: () => null })).toBeNull();
    expect(
      readCachedVerifiedGameActivity({
        getItem: () => {
          throw new Error('storage denied');
        },
      }),
    ).toBeNull();
    expect(() =>
      writeCachedVerifiedGameActivity(page, {
        setItem: () => {
          throw new Error('storage denied');
        },
      }),
    ).not.toThrow();
  });

  test('resolves only canonical API-owned receipt links', () => {
    const href = '/v1/duels/duel_activity000001/receipt';
    expect(resolveActivityApiHref(href, 'https://api.dailydraft.fun/v1')).toBe(
      'https://api.dailydraft.fun/v1/duels/duel_activity000001/receipt',
    );
    expect(resolveActivityApiHref(href, '/__journey/v1')).toBe(
      '/__journey/v1/duels/duel_activity000001/receipt',
    );
    expect(resolveActivityApiHref(href, undefined)).toBe(href);
    expect(resolveActivityApiHref(href, 'https://api.dailydraft.fun')).toBe(
      'https://api.dailydraft.fun/v1/duels/duel_activity000001/receipt',
    );
  });
});

function activityPage(
  data: VerifiedGameActivityPage['data'] = [verifiedGameActivityContractFixtures.duel],
): VerifiedGameActivityPage {
  return {
    asOf: '2026-07-28T12:00:00.000Z',
    data,
    hasMore: false,
    nextCursor: null,
    schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  };
}

function duelActivity(id: string, occurredAt: string): VerifiedGameActivity {
  return {
    ...verifiedGameActivityContractFixtures.duel,
    activityId: `duel:${id}`,
    occurredAt,
    receiptHref: `/v1/duels/${id}/receipt`,
    resultHref: `/v1/rgs/rounds/duel/${id}/proof`,
  };
}
