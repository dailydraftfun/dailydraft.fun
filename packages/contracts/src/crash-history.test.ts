import { describe, expect, test } from 'bun:test';

import {
  type CrashReceiptEvent,
  compareCrashReceiptEvents,
  isCrashReceiptEventId,
} from './crash-history.js';

const OCCURRED_AT = '2026-07-28T18:00:04.000Z';

describe('Crash receipt event contract', () => {
  test('orders equal timestamps by domain and numeric sequence without changing public ids', () => {
    const events = [
      event('settlement:10', 'settlement-prepared'),
      event(`custody:crashref_${'b'.repeat(32)}`, 'custody-prepared'),
      event('transition:10', 'stage-continued'),
      event('settlement:2', 'settlement-finalized'),
      event(`custody:crashref_${'a'.repeat(32)}`, 'custody-recovery-required'),
      event('transition:2', 'round-started'),
    ].sort(compareCrashReceiptEvents);

    expect(events.map(({ eventId }) => eventId)).toEqual([
      'transition:2',
      'transition:10',
      `custody:crashref_${'a'.repeat(32)}`,
      `custody:crashref_${'b'.repeat(32)}`,
      'settlement:2',
      'settlement:10',
    ]);
  });

  test.each([
    ['custody-prepared', `custody:crashref_${'a'.repeat(32)}`],
    ['custody-recovery-required', `custody:crashref_${'b'.repeat(32)}`],
    ['deadline-defaulted', 'transition:1'],
    ['round-busted', 'transition:2'],
    ['round-cashed-out', 'transition:3'],
    ['round-completed', 'transition:4'],
    ['round-started', 'transition:5'],
    ['settlement-finalized', 'settlement:1'],
    ['settlement-prepared', 'settlement:2'],
    ['settlement-recovery-required', 'settlement:3'],
    ['stage-continued', 'transition:6'],
  ] as const)('binds %s to its canonical event-id domain', (kind, eventId) => {
    expect(isCrashReceiptEventId(eventId, kind)).toBe(true);
    expect(isCrashReceiptEventId('transition:0', kind)).toBe(false);
    expect(isCrashReceiptEventId('settlement:1', kind)).toBe(kind.startsWith('settlement-'));
  });
});

function event(eventId: string, kind: CrashReceiptEvent['kind']): CrashReceiptEvent {
  return {
    amount: null,
    decision: null,
    eventId,
    kind,
    occurredAt: OCCURRED_AT,
    reference: `crashref_${'1'.repeat(32)}`,
    scheduledDeadline: null,
    stage: 1,
    terminalReason: null,
  };
}
