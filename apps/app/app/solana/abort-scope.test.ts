import { describe, expect, test } from 'bun:test';
import { createAbortScope } from './abort-scope';

describe('createAbortScope', () => {
  test('hands out a live signal for the first attempt', () => {
    const scope = createAbortScope();

    expect(scope.begin().aborted).toBe(false);
  });

  test('aborts the previous attempt when a new one begins', () => {
    const scope = createAbortScope();

    const first = scope.begin();
    const second = scope.begin();

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  test('aborts the in-flight attempt on cancel', () => {
    const scope = createAbortScope();

    const signal = scope.begin();
    scope.cancel();

    expect(signal.aborted).toBe(true);
  });

  test('cancel is safe before any attempt and after a previous cancel', () => {
    const scope = createAbortScope();

    expect(() => scope.cancel()).not.toThrow();

    scope.begin();
    scope.cancel();

    expect(() => scope.cancel()).not.toThrow();
  });

  test('begins a live attempt again after a cancel', () => {
    const scope = createAbortScope();

    const cancelled = scope.begin();
    scope.cancel();
    const resumed = scope.begin();

    // A retry after the funding attempt was abandoned has to get a usable
    // signal, and the abandoned one has to stay abandoned.
    expect(resumed.aborted).toBe(false);
    expect(cancelled.aborted).toBe(true);
  });

  test('builds each attempt through the injected controller factory', () => {
    const controllers: AbortController[] = [];
    const scope = createAbortScope(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller;
    });

    scope.begin();
    scope.begin();

    expect(controllers).toHaveLength(2);
    expect(controllers[0]?.signal.aborted).toBe(true);
  });
});
