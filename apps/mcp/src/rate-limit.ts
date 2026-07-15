export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  readonly #limit: number;
  readonly #states = new Map<string, WindowState>();
  readonly #windowMs: number;

  constructor(
    limit = readPositiveInteger(process.env.OPENPACKSDUEL_MCP_RATE_LIMIT, 60),
    windowMs = 60_000,
  ) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    this.#removeExpired(now);
    const current = this.#states.get(key);
    const state =
      !current || current.resetAt <= now ? { count: 0, resetAt: now + this.#windowMs } : current;
    state.count += 1;
    this.#states.set(key, state);

    return {
      allowed: state.count <= this.#limit,
      limit: this.#limit,
      remaining: Math.max(0, this.#limit - state.count),
      retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1_000)),
    };
  }

  #removeExpired(now: number): void {
    if (this.#states.size < 1_000) return;
    for (const [key, state] of this.#states) {
      if (state.resetAt <= now) this.#states.delete(key);
    }
  }
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new Error('OPENPACKSDUEL_MCP_RATE_LIMIT must be an integer between 1 and 10000');
  }
  return parsed;
}
