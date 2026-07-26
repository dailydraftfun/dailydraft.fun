import { describe, expect, test } from 'bun:test';
import { CONFIRMATION_POLL_INTERVAL_MS, type ConfirmationPhase } from './confirmation';
import { type ConfirmationPoll, trackConfirmation } from './track-confirmation';

const pending: ConfirmationPoll = { commitment: null, failed: false };

/**
 * Drives the tracker on a virtual clock: every sleep advances `now` by the poll
 * interval, so a 90s deadline is reachable in microseconds and the assertions
 * never depend on wall time.
 */
function harness(polls: Array<ConfirmationPoll | Error>) {
  const phases: ConfirmationPhase[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  let index = 0;
  return {
    phases,
    sleeps,
    options: {
      now: () => clock,
      onPhase: (phase: ConfirmationPhase) => phases.push(phase),
      poll: async () => {
        const next = polls[Math.min(index, polls.length - 1)];
        index += 1;
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
    },
  };
}

describe('trackConfirmation', () => {
  test('polls the live RPC endpoint when no dependencies are injected', async () => {
    // Every other case here injects poll/now/sleep, which would leave the real
    // wiring — the defaults an actual funding flow runs on — untested.
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({
        id: '1',
        jsonrpc: '2.0',
        result: { value: [{ confirmationStatus: 'finalized', err: null }] },
      });
    }) as unknown as typeof fetch;

    try {
      // Finalized on the first poll, so no sleep elapses and the test stays
      // wall-clock free despite using the real interval.
      const phase = await trackConfirmation('sig');

      expect(phase).toBe('finalized');
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('reports every phase change from broadcast to confirmed', async () => {
    const { options, phases } = harness([
      pending,
      { commitment: 'processed', failed: false },
      { commitment: 'confirmed', failed: false },
    ]);

    const phase = await trackConfirmation('sig', options);

    expect(phase).toBe('confirmed');
    expect(phases).toEqual(['submitted', 'processed', 'confirmed']);
  });

  test('stops at confirmed rather than holding the step open for finalization', async () => {
    const { options, sleeps } = harness([{ commitment: 'confirmed', failed: false }]);

    await trackConfirmation('sig', options);

    expect(sleeps).toEqual([]);
  });

  test('resolves immediately when the first poll answers finalized', async () => {
    const { options, phases } = harness([{ commitment: 'finalized', failed: false }]);

    expect(await trackConfirmation('sig', options)).toBe('finalized');
    expect(phases).toEqual(['submitted', 'finalized']);
  });

  test('surfaces an on-chain rejection', async () => {
    const { options, phases } = harness([{ commitment: 'processed', failed: true }]);

    expect(await trackConfirmation('sig', options)).toBe('failed');
    expect(phases).toEqual(['submitted', 'failed']);
  });

  test('treats a rejected poll as no news instead of a failure', async () => {
    const { options } = harness([
      new Error('rpc unreachable'),
      { commitment: 'confirmed', failed: false },
    ]);

    expect(await trackConfirmation('sig', options)).toBe('confirmed');
  });

  test('expires once the deadline passes with no commitment', async () => {
    const { options, phases, sleeps } = harness([pending]);

    expect(await trackConfirmation('sig', options)).toBe('expired');
    expect(phases.at(-1)).toBe('expired');
    expect(sleeps.every((value) => value === CONFIRMATION_POLL_INTERVAL_MS)).toBe(true);
  });

  test('stops polling when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const { options, sleeps } = harness([pending]);

    expect(await trackConfirmation('sig', { ...options, signal: controller.signal })).toBe(
      'submitted',
    );
    expect(sleeps).toEqual([]);
  });

  test('runs without callbacks when only the resolved phase is wanted', async () => {
    const { options } = harness([{ commitment: 'confirmed', failed: false }]);

    expect(
      await trackConfirmation('sig', {
        now: options.now,
        poll: options.poll,
        sleep: options.sleep,
      }),
    ).toBe('confirmed');
  });
});
