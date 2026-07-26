import { describe, expect, test } from 'bun:test';
import {
  advanceConfirmation,
  CONFIRMATION_TIMEOUT_MS,
  type ConfirmationPhase,
  describeConfirmation,
  isFundingSettled,
  isTerminalPhase,
  resolveConfirmationTimeout,
} from './confirmation';

const pending = { commitment: null, failed: false };

describe('advanceConfirmation', () => {
  test('walks forward through the commitment ladder', () => {
    let phase: ConfirmationPhase = 'submitted';
    phase = advanceConfirmation(phase, { commitment: 'processed', failed: false });
    expect(phase).toBe('processed');
    phase = advanceConfirmation(phase, { commitment: 'confirmed', failed: false });
    expect(phase).toBe('confirmed');
    phase = advanceConfirmation(phase, { commitment: 'finalized', failed: false });
    expect(phase).toBe('finalized');
  });

  test('never regresses when a validator answers a lower commitment', () => {
    expect(advanceConfirmation('confirmed', { commitment: 'processed', failed: false })).toBe(
      'confirmed',
    );
  });

  test('holds the last known phase when the signature drops out of the status cache', () => {
    expect(advanceConfirmation('confirmed', pending)).toBe('confirmed');
    expect(advanceConfirmation('submitted', pending)).toBe('submitted');
  });

  test('a reported error moves straight to failed from any phase', () => {
    expect(advanceConfirmation('submitted', { commitment: null, failed: true })).toBe('failed');
    expect(advanceConfirmation('confirmed', { commitment: 'confirmed', failed: true })).toBe(
      'failed',
    );
  });

  test('terminal phases ignore further polls', () => {
    expect(advanceConfirmation('finalized', { commitment: 'processed', failed: false })).toBe(
      'finalized',
    );
    expect(advanceConfirmation('failed', { commitment: 'finalized', failed: false })).toBe(
      'failed',
    );
    expect(advanceConfirmation('expired', { commitment: 'confirmed', failed: false })).toBe(
      'expired',
    );
  });
});

describe('isTerminalPhase', () => {
  test('only finalized, failed and expired end the poll loop', () => {
    expect(isTerminalPhase('finalized')).toBe(true);
    expect(isTerminalPhase('failed')).toBe(true);
    expect(isTerminalPhase('expired')).toBe(true);
    expect(isTerminalPhase('confirmed')).toBe(false);
    expect(isTerminalPhase('processed')).toBe(false);
    expect(isTerminalPhase('submitted')).toBe(false);
  });
});

describe('isFundingSettled', () => {
  test('unblocks at confirmed rather than making the user wait for finalization', () => {
    expect(isFundingSettled('confirmed')).toBe(true);
    expect(isFundingSettled('finalized')).toBe(true);
    expect(isFundingSettled('processed')).toBe(false);
    expect(isFundingSettled('submitted')).toBe(false);
    expect(isFundingSettled('failed')).toBe(false);
    expect(isFundingSettled('expired')).toBe(false);
  });
});

describe('resolveConfirmationTimeout', () => {
  test('expires a transaction still short of confirmation past the deadline', () => {
    expect(resolveConfirmationTimeout('processed', CONFIRMATION_TIMEOUT_MS)).toBe('expired');
    expect(resolveConfirmationTimeout('submitted', CONFIRMATION_TIMEOUT_MS + 1)).toBe('expired');
  });

  test('leaves a phase alone before the deadline', () => {
    expect(resolveConfirmationTimeout('processed', CONFIRMATION_TIMEOUT_MS - 1)).toBe('processed');
  });

  test('a settled transaction is never expired by a slow finalization', () => {
    expect(resolveConfirmationTimeout('confirmed', CONFIRMATION_TIMEOUT_MS * 10)).toBe('confirmed');
    expect(resolveConfirmationTimeout('finalized', CONFIRMATION_TIMEOUT_MS * 10)).toBe('finalized');
  });

  test('a failure is not overwritten by the deadline', () => {
    expect(resolveConfirmationTimeout('failed', CONFIRMATION_TIMEOUT_MS * 10)).toBe('failed');
  });
});

describe('describeConfirmation', () => {
  const phases: ConfirmationPhase[] = [
    'submitted',
    'processed',
    'confirmed',
    'finalized',
    'failed',
    'expired',
  ];

  test('every phase has a distinct label and a tone', () => {
    const labels = phases.map((phase) => describeConfirmation(phase).label);
    expect(new Set(labels).size).toBe(phases.length);
  });

  test('tones follow the outcome, not the position in the ladder', () => {
    expect(describeConfirmation('submitted').tone).toBe('pending');
    expect(describeConfirmation('processed').tone).toBe('pending');
    expect(describeConfirmation('confirmed').tone).toBe('success');
    expect(describeConfirmation('finalized').tone).toBe('success');
    expect(describeConfirmation('failed').tone).toBe('danger');
    expect(describeConfirmation('expired').tone).toBe('danger');
  });

  test('the failure copy states that no funds moved', () => {
    expect(describeConfirmation('failed').detail).toContain('No funds left the wallet');
  });
});
