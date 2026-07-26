import { describe, expect, test } from 'bun:test';
import { CONFIRMATION_POLL_INTERVAL_MS, type ConfirmationPhase } from './confirmation';
import {
  type ConfirmationPoll,
  sleepForConfirmation,
  trackConfirmation,
} from './track-confirmation';

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
  test('the default sleep handles timers and both abort timings', async () => {
    await sleepForConfirmation(0);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await sleepForConfirmation(10_000, alreadyAborted.signal);

    const inFlight = new AbortController();
    const waiting = sleepForConfirmation(10_000, inFlight.signal);
    inFlight.abort();
    await waiting;
  });

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

  test('discards an in-flight poll when a replacement attempt aborts it', async () => {
    const controller = new AbortController();
    const phases: ConfirmationPhase[] = [];
    let resolvePoll: ((result: ConfirmationPoll) => void) | undefined;
    const poll = new Promise<ConfirmationPoll>((resolve) => {
      resolvePoll = resolve;
    });
    const tracking = trackConfirmation('sig', {
      onPhase: (phase) => phases.push(phase),
      poll: () => poll,
      signal: controller.signal,
      sleep: async () => {
        throw new Error('an aborted in-flight poll must not sleep');
      },
    });

    await Promise.resolve();
    controller.abort();
    resolvePoll?.({ commitment: 'confirmed', failed: false });

    expect(await tracking).toBe('submitted');
    expect(phases).toEqual(['submitted']);
  });

  test('stops waiting out the poll interval the moment the caller aborts', async () => {
    const controller = new AbortController();
    let releaseSleep = () => {};
    // A sleep that never settles on its own: if the tracker waited on the timer
    // rather than on the abort, this test would hang instead of failing.
    const stalledSleep = () =>
      new Promise<void>((resolve) => {
        releaseSleep = resolve;
      });

    const tracked = trackConfirmation('sig', {
      now: () => 0,
      poll: async () => pending,
      sleep: stalledSleep,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    expect(await tracked).toBe('submitted');
    releaseSleep();
  });

  test('stops before sleeping when the caller aborts during an in-flight poll', async () => {
    const controller = new AbortController();
    let releasePoll = (_result: ConfirmationPoll) => {};
    let sleepCalled = false;
    const tracked = trackConfirmation('sig', {
      now: () => 0,
      poll: () =>
        new Promise<ConfirmationPoll>((resolve) => {
          releasePoll = resolve;
        }),
      sleep: () => {
        sleepCalled = true;
        return new Promise<void>(() => {});
      },
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort();
    releasePoll(pending);

    expect(await tracked).toBe('submitted');
    expect(sleepCalled).toBe(false);
  });

  test('propagates a rejected injected sleep instead of hanging', async () => {
    const controller = new AbortController();

    expect(
      trackConfirmation('sig', {
        now: () => 0,
        poll: async () => pending,
        sleep: async () => {
          throw new Error('sleep failed');
        },
        signal: controller.signal,
      }),
    ).rejects.toThrow('sleep failed');
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
