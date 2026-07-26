/**
 * Owns the lifetime of a cancellable background request.
 *
 * `trackConfirmation` polls the cluster for up to 90 seconds, so the caller that
 * starts it has to be able to stop it — when the component unmounts, and when a
 * retry makes the previous attempt's signature no longer the one being funded.
 * Kept free of React so the cancellation rules are unit-testable; components
 * hold one of these in a ref.
 */
export type AbortScope = {
  /** Cancels any attempt already in flight and returns the new attempt's signal. */
  readonly begin: () => AbortSignal;
  /** Cancels the in-flight attempt, if any, without starting another. */
  readonly cancel: () => void;
};

export function createAbortScope(
  createController: () => AbortController = () => new AbortController(),
): AbortScope {
  let active: AbortController | null = null;

  return {
    begin() {
      active?.abort();
      active = createController();
      return active.signal;
    },
    cancel() {
      active?.abort();
      active = null;
    },
  };
}
