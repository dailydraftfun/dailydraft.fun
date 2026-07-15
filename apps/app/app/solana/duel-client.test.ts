import { describe, expect, test } from 'bun:test';

import { submissionIdempotencyKey } from './duel-client';

describe('submissionIdempotencyKey', () => {
  test('reuses one key when a successful submission response is lost', () => {
    const intentId = 'tx_12345678901234567890123456789012';

    expect(submissionIdempotencyKey(intentId)).toBe(submissionIdempotencyKey(intentId));
    expect(submissionIdempotencyKey(intentId)).toBe(`opd-submit-${intentId}`);
  });

  test('does not collide across prepared intents', () => {
    expect(submissionIdempotencyKey('tx_first')).not.toBe(submissionIdempotencyKey('tx_second'));
  });
});
