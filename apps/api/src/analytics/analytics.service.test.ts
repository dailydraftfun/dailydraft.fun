import { describe, expect, test } from 'bun:test';

import { buildFunnelReport, type NormalizedEvent } from './analytics.service.js';

const NOW = new Date('2026-07-15T20:00:00.000Z');

describe('analytics funnel report', () => {
  test('deduplicates client and server events and calculates match/provider latency', () => {
    const events = [
      event('duel_created', 0),
      event('duel_created', 50),
      event('duel_matched', 2_000),
      event('duel_matched', 2_100),
      event('duel_funded', 3_000),
      event('pack_reveal_started', 4_000),
      event('pack_revealed', 5_500),
      event('pack_revealed', 5_600),
      event('duel_settled', 6_000),
    ];

    const report = reportFor(events);

    expect(report.funnel.counts.duel_created).toBe(1);
    expect(report.funnel.counts.duel_matched).toBe(1);
    expect(report.latencyMs.match).toEqual({ count: 1, p50: 2_000, p95: 2_000 });
    expect(report.latencyMs.provider).toEqual({ count: 1, p50: 1_500, p95: 1_500 });
    expect(report.funnel.rates.settledFromRevealed).toBe(1);
  });

  test('reports abandonment, refund, settlement failure, and infrastructure errors', () => {
    const abandonedCreatedAt = -20 * 60 * 1_000;
    const events = [
      event('duel_created', abandonedCreatedAt, 'duel_abandoned0001', 'anon_a'.padEnd(37, 'a')),
      event('duel_created', -20 * 60 * 1_000),
      event('duel_funded', -19 * 60 * 1_000),
      event('duel_refunded', -18 * 60 * 1_000),
      event('pack_revealed', -17 * 60 * 1_000),
      event('settlement_failed', -16 * 60 * 1_000),
      event('provider_error', -15 * 60 * 1_000),
      event('solana_rpc_error', -14 * 60 * 1_000),
    ];

    const report = reportFor(events);

    expect(report.rates.abandonment).toBe(0.5);
    expect(report.rates.refund).toBe(1);
    expect(report.rates.settlementFailure).toBe(1);
    expect(report.errors.provider).toBe(1);
    expect(report.errors.solanaRpc).toBe(1);
  });

  test('does not let client events forge lifecycle progress or operational alerts', () => {
    const events = [
      event('duel_created', 0, undefined, undefined, 'client'),
      event('duel_matched', 1_000, undefined, undefined, 'client'),
      event('duel_funded', 2_000, undefined, undefined, 'client'),
      event('pack_revealed', 3_000, undefined, undefined, 'client'),
      event('duel_settled', 4_000, undefined, undefined, 'client'),
      event('provider_error', 5_000, undefined, undefined, 'client'),
      event('solana_rpc_error', 6_000, undefined, undefined, 'client'),
      event('ui_error', 7_000, undefined, undefined, 'client'),
    ];

    const report = reportFor(events);

    expect(report.funnel.counts.duel_created).toBe(0);
    expect(report.funnel.counts.duel_settled).toBe(0);
    expect(report.errors.provider).toBe(0);
    expect(report.errors.solanaRpc).toBe(0);
    expect(report.experience.uiErrors).toBe(1);
  });

  test('surfaces the configured stuck-funded alert without exposing wallet data', () => {
    const report = buildFunnelReport({
      events: [],
      generatedAt: NOW,
      oldestStuck: { fundedAt: new Date('2026-07-15T19:50:00.000Z'), id: 'duel_stuck0000001' },
      statuses: { funded: 2 },
      stuckCount: 2,
      stuckThresholdMinutes: 5,
      truncated: false,
      windowHours: 24,
      windowStart: new Date('2026-07-14T20:00:00.000Z'),
    });

    expect(report.alerts.stuckFunded.active).toBe(true);
    expect(report.alerts.stuckFunded.count).toBe(2);
    expect(JSON.stringify(report)).not.toContain('9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1');
    expect(JSON.stringify(report)).not.toContain('token');
    expect(JSON.stringify(report)).not.toContain('signature');
  });
});

function reportFor(events: NormalizedEvent[]) {
  return buildFunnelReport({
    events,
    generatedAt: NOW,
    oldestStuck: null,
    statuses: {},
    stuckCount: 0,
    stuckThresholdMinutes: 5,
    truncated: false,
    windowHours: 24,
    windowStart: new Date('2026-07-14T20:00:00.000Z'),
  });
}

function event(
  name: NormalizedEvent['name'],
  offsetMs: number,
  duelId: string | undefined = 'duel_test00000001',
  sessionId: string | undefined = 'anon_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  source: NormalizedEvent['source'] = 'server',
): NormalizedEvent {
  return {
    createdAt: new Date(NOW.getTime() + offsetMs),
    duelId: duelId ?? null,
    id: `pevt_${name}_${offsetMs}`,
    mode: 'direct',
    name,
    sessionId: sessionId ?? null,
    source,
    status: null,
    tier: 50,
  };
}
