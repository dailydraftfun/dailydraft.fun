'use client';

export type ProductEventName =
  | 'lobby_viewed'
  | 'tier_selected'
  | 'wallet_connected'
  | 'wallet_authenticated'
  | 'pack_reveal_started'
  | 'duel_shared'
  | 'duel_rematched'
  | 'ui_error';

export type ProductEvent = {
  duelId?: string;
  mode?: 'direct' | 'house' | 'open';
  name: ProductEventName;
  status?:
    | 'waiting'
    | 'matched'
    | 'committing'
    | 'funded'
    | 'opening'
    | 'awaiting_assets'
    | 'settling'
    | 'settled'
    | 'cancelling'
    | 'cancelled'
    | 'refunding'
    | 'refunded'
    | 'failed';
  tier?: 25 | 50 | 100;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');
const sessionStorageKey = 'openpacksduel.analytics-session';
const queuedEvents: ProductEvent[] = [];
let flushTimer: number | undefined;
let pagehideListenerRegistered = false;
let inMemorySessionId: string | undefined;

export function getAnalyticsSessionId(): string {
  if (inMemorySessionId) return inMemorySessionId;
  try {
    const existing = window.sessionStorage.getItem(sessionStorageKey);
    if (existing?.match(/^anon_[a-f0-9]{32}$/)) {
      inMemorySessionId = existing;
      return existing;
    }
  } catch {
    // Storage can be disabled; a memory-only session still preserves privacy and availability.
  }
  inMemorySessionId = `anon_${crypto.randomUUID().replaceAll('-', '')}`;
  try {
    window.sessionStorage.setItem(sessionStorageKey, inMemorySessionId);
  } catch {
    // The generated identifier remains memory-only for this page lifecycle.
  }
  return inMemorySessionId;
}

export function trackProductEvent(event: ProductEvent): void {
  if (!apiBaseUrl || typeof window === 'undefined') return;
  if (!pagehideListenerRegistered) {
    window.addEventListener('pagehide', () => void flushProductEvents());
    pagehideListenerRegistered = true;
  }
  queuedEvents.push(event);
  if (queuedEvents.length >= 10) {
    void flushProductEvents();
    return;
  }
  flushTimer ??= window.setTimeout(() => void flushProductEvents(), 750);
}

export async function flushProductEvents(): Promise<void> {
  if (!apiBaseUrl || queuedEvents.length === 0) return;
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushTimer = undefined;
  const events = queuedEvents.splice(0, 20);
  try {
    await fetch(`${apiBaseUrl}/analytics/events`, {
      body: JSON.stringify({ events, sessionId: getAnalyticsSessionId() }),
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      method: 'POST',
    });
  } catch {
    // Analytics is best-effort and must never block wallet or duel actions.
  }
  if (queuedEvents.length > 0) flushTimer = window.setTimeout(() => void flushProductEvents(), 750);
}
