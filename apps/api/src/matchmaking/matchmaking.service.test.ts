import { describe, expect, test } from 'bun:test';
import { DuelMode, DuelStatus, MatchmakingTicketRole, ProviderMode } from '@dailydraft/db';

import type { Pack } from '../domain.js';
import {
  commitmentTimeoutPolicy,
  loadQueueSegment,
  nextBehaviorState,
  queueSegmentKey,
  shouldRetryMatchmakingTransaction,
} from './matchmaking.service.js';

const PACK: Pack = {
  active: true,
  id: 'pokemon_50',
  name: 'Pokémon $50 Pack',
  price: { amount: '50000000', currency: 'USDC', decimals: 6 },
  provider: 'jupiter-gacha',
  valuationPolicyHash: 'a'.repeat(64),
};

describe('open matchmaking queue policy', () => {
  test('segments queues by exact tier, valuation policy, provider, region, and risk', () => {
    const base = {
      pack: PACK,
      providerMode: ProviderMode.MOCK,
      regionSegment: 'eu',
      riskSegment: 'standard',
    };
    const key = queueSegmentKey(base);

    expect(queueSegmentKey(base)).toBe(key);
    expect(queueSegmentKey({ ...base, regionSegment: 'us' })).not.toBe(key);
    expect(queueSegmentKey({ ...base, riskSegment: 'restricted' })).not.toBe(key);
    expect(
      queueSegmentKey({
        ...base,
        pack: { ...PACK, valuationPolicyHash: 'b'.repeat(64) },
      }),
    ).not.toBe(key);
    expect(
      queueSegmentKey({ ...base, providerMode: ProviderMode.COLLECTOR_CRYPT_SANDBOX }),
    ).not.toBe(key);
  });

  test('fails closed without server-verified region and risk segments', () => {
    expect(() => loadQueueSegment({})).toThrow('region segment is not configured');
    expect(() => loadQueueSegment({ DAILYDRAFT_MATCHMAKING_REGION_SEGMENT: 'eu' })).toThrow(
      'risk segment is not configured',
    );
    expect(
      loadQueueSegment({
        DAILYDRAFT_MATCHMAKING_REGION_SEGMENT: 'eu',
        DAILYDRAFT_MATCHMAKING_RISK_SEGMENT: 'standard',
      }),
    ).toEqual({ regionSegment: 'eu', riskSegment: 'standard' });
  });

  test('blocks repeated failed commitments and resets an expired failure window', () => {
    const now = new Date('2026-07-15T20:00:00.000Z');
    const first = nextBehaviorState(null, now, { blockMs: 30_000, maxFailures: 2 });
    const second = nextBehaviorState(first, new Date(now.getTime() + 1_000), {
      blockMs: 30_000,
      maxFailures: 2,
    });
    const reset = nextBehaviorState(first, new Date(now.getTime() + 61 * 60 * 1_000), {
      blockMs: 30_000,
      maxFailures: 2,
    });

    expect(first.blockedUntil).toBeNull();
    expect(second.failedCommitments).toBe(2);
    expect(second.blockedUntil?.toISOString()).toBe('2026-07-15T20:00:31.000Z');
    expect(reset.failedCommitments).toBe(1);
    expect(reset.blockedUntil).toBeNull();
  });

  test('assigns timeout responsibility to the protocol-required funding side', () => {
    expect(
      commitmentTimeoutPolicy({
        creatorBlocked: false,
        creatorFunded: false,
        mode: DuelMode.OPEN,
        status: DuelStatus.MATCHED,
      }),
    ).toMatchObject({
      canRequeueCreator: true,
      nextStatus: DuelStatus.WAITING,
      offenderRole: MatchmakingTicketRole.CREATOR,
    });
    expect(
      commitmentTimeoutPolicy({
        creatorBlocked: false,
        creatorFunded: true,
        mode: DuelMode.OPEN,
        status: DuelStatus.COMMITTING,
      }),
    ).toMatchObject({
      cancellationReason: 'opponent_commitment_timeout',
      canRequeueCreator: false,
      nextStatus: DuelStatus.REFUNDING,
      offenderRole: MatchmakingTicketRole.OPPONENT,
    });
    expect(
      commitmentTimeoutPolicy({
        creatorBlocked: false,
        creatorFunded: false,
        mode: DuelMode.OPEN,
        status: DuelStatus.COMMITTING,
      }),
    ).toMatchObject({
      cancellationReason: 'funding_finality_timeout',
      canRequeueCreator: false,
      nextStatus: DuelStatus.REFUNDING,
      offenderRole: null,
    });
  });

  test('bounds retries to Prisma serialization and deadlock conflicts', () => {
    expect(shouldRetryMatchmakingTransaction({ code: 'P2034' }, 1)).toBe(true);
    expect(shouldRetryMatchmakingTransaction({ code: 'P2034' }, 3)).toBe(false);
    expect(shouldRetryMatchmakingTransaction({ code: 'P2002' }, 1)).toBe(false);
    expect(shouldRetryMatchmakingTransaction(new Error('network'), 1)).toBe(false);
  });
});
