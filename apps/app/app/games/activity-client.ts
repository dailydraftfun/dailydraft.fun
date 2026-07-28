'use client';

import {
  PUBLIC_GAME_MODE_IDS,
  type PublicGameModeId,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivity,
  type VerifiedGameActivityPage,
} from '@dailydraft/contracts/game-lobby';

const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');
const ACTIVITY_CACHE_KEY = 'dailydraft.verified-game-activity.v1';
const ACTIVITY_TIMEOUT_MS = 8_000;
const RAW_SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EMBEDDED_SOLANA_ADDRESS_PATTERN =
  /(?:^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?=$|[^1-9A-HJ-NP-Za-km-z])/;
const PUBLIC_LABEL_PATTERN =
  /^(?:DailyDraft House|Player [A-Z0-9]{4,12}|[1-9A-HJ-NP-Za-km-z]{2,8}…[1-9A-HJ-NP-Za-km-z]{2,8})$/;

type ActivityFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ActivityApiUnavailableError extends Error {
  constructor() {
    super('The verified activity API is not configured.');
    this.name = 'ActivityApiUnavailableError';
  }
}

export async function getVerifiedGameActivity(
  limit = 6,
  baseUrl: string | undefined = apiBaseUrl,
  fetcher: ActivityFetch = fetch,
): Promise<VerifiedGameActivityPage> {
  if (!baseUrl) throw new ActivityApiUnavailableError();
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 6;
  const signal = AbortSignal.timeout(ACTIVITY_TIMEOUT_MS);
  const response = await fetcher(`${baseUrl}/games/activity?limit=${boundedLimit}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Verified activity is unavailable (${response.status}).`);
  }
  return parseVerifiedGameActivityPage(await response.json());
}

export function parseVerifiedGameActivityPage(value: unknown): VerifiedGameActivityPage {
  if (!isObject(value)) throw malformedActivityError();
  if (
    value.schemaVersion !== VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION ||
    !isCanonicalIsoDate(value.asOf) ||
    !Array.isArray(value.data) ||
    value.data.length > 50 ||
    typeof value.hasMore !== 'boolean' ||
    !isActivityCursor(value.nextCursor)
  ) {
    throw malformedActivityError();
  }

  const data = value.data.map(parseActivity);
  if (new Set(data.map((activity) => activity.activityId)).size !== data.length) {
    throw malformedActivityError();
  }
  for (let index = 1; index < data.length; index += 1) {
    const previous = data[index - 1];
    const current = data[index];
    if (!previous || !current || compareActivity(previous, current) > 0) {
      throw malformedActivityError();
    }
  }

  return {
    asOf: value.asOf,
    data,
    hasMore: value.hasMore,
    nextCursor: value.nextCursor,
    schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  };
}

export function readCachedVerifiedGameActivity(
  storage: Pick<Storage, 'getItem'>,
): VerifiedGameActivityPage | null {
  try {
    const serialized = storage.getItem(ACTIVITY_CACHE_KEY);
    return serialized ? parseVerifiedGameActivityPage(JSON.parse(serialized)) : null;
  } catch {
    return null;
  }
}

export function writeCachedVerifiedGameActivity(
  page: VerifiedGameActivityPage,
  storage: Pick<Storage, 'setItem'>,
): void {
  try {
    storage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify(page));
  } catch {
    // Storage is optional. The in-memory verified response remains authoritative.
  }
}

export function resolveActivityApiHref(
  href: VerifiedGameActivity['receiptHref'] | VerifiedGameActivity['resultHref'],
  baseUrl: string | undefined = apiBaseUrl,
): string {
  if (!baseUrl) return href;
  const apiRoot = baseUrl.endsWith('/v1') ? baseUrl.slice(0, -3) : baseUrl;
  return `${apiRoot}${href}`;
}

function parseActivity(value: unknown): VerifiedGameActivity {
  if (!isObject(value)) throw malformedActivityError();
  const mode = value.mode;
  if (!PUBLIC_GAME_MODE_IDS.includes(mode as PublicGameModeId)) throw malformedActivityError();
  const publicMode = mode as PublicGameModeId;
  if (
    typeof value.activityId !== 'string' ||
    !value.activityId.startsWith(`${publicMode}:`) ||
    !isCanonicalIsoDate(value.occurredAt) ||
    !Array.isArray(value.participants) ||
    value.participants.length !== (publicMode === 'duel' ? 2 : 1) ||
    !value.participants.every(isPublicParticipant) ||
    typeof value.receiptHref !== 'string' ||
    typeof value.resultHref !== 'string' ||
    typeof value.result !== 'string' ||
    value.result.length < 1 ||
    value.result.length > 120 ||
    typeof value.resultSummary !== 'string' ||
    value.resultSummary.length < 1 ||
    value.resultSummary.length > 280 ||
    containsRawSolanaAddress(value.resultSummary) ||
    typeof value.title !== 'string' ||
    value.title.length < 1 ||
    value.title.length > 160 ||
    containsRawSolanaAddress(value.title) ||
    value.verification !== 'settled-rgs-proof' ||
    !isMoney(value.tier)
  ) {
    throw malformedActivityError();
  }

  const roundId = value.activityId.slice(publicMode.length + 1);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(roundId)) throw malformedActivityError();
  const resultHref =
    `/v1/rgs/rounds/${publicMode}/${roundId}/proof` as VerifiedGameActivity['resultHref'];
  const receiptHref = (
    publicMode === 'duel' ? `/v1/duels/${roundId}/receipt` : resultHref
  ) as VerifiedGameActivity['receiptHref'];
  if (value.resultHref !== resultHref || value.receiptHref !== receiptHref) {
    throw malformedActivityError();
  }

  return {
    activityId: `${publicMode}:${roundId}`,
    mode: publicMode,
    occurredAt: value.occurredAt,
    participants: value.participants.map((participant) => ({
      label: participant.label,
      role: participant.role,
    })),
    receiptHref,
    result: value.result,
    resultHref,
    resultSummary: value.resultSummary,
    tier: {
      amount: value.tier.amount,
      currency: 'USDC',
      decimals: 6,
    },
    title: value.title,
    verification: 'settled-rgs-proof',
  };
}

function containsRawSolanaAddress(value: string): boolean {
  return EMBEDDED_SOLANA_ADDRESS_PATTERN.test(value);
}

function isPublicParticipant(
  value: unknown,
): value is VerifiedGameActivity['participants'][number] {
  if (
    !isObject(value) ||
    typeof value.label !== 'string' ||
    !['house', 'player'].includes(String(value.role))
  ) {
    return false;
  }
  return (
    !RAW_SOLANA_ADDRESS_PATTERN.test(value.label) &&
    PUBLIC_LABEL_PATTERN.test(value.label) &&
    (value.role === 'house') === (value.label === 'DailyDraft House')
  );
}

function isMoney(value: unknown): value is VerifiedGameActivity['tier'] {
  return (
    isObject(value) &&
    typeof value.amount === 'string' &&
    /^(0|[1-9][0-9]{0,19})$/.test(value.amount) &&
    value.currency === 'USDC' &&
    value.decimals === 6
  );
}

function isActivityCursor(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^v1\.[A-Za-z0-9_-]{1,480}$/.test(value));
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function compareActivity(left: VerifiedGameActivity, right: VerifiedGameActivity): number {
  const occurredAt = right.occurredAt.localeCompare(left.occurredAt);
  if (occurredAt !== 0) return occurredAt;
  const mode = left.mode.localeCompare(right.mode);
  return mode || right.activityId.localeCompare(left.activityId);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformedActivityError(): Error {
  return new Error('The games API returned malformed verified activity.');
}
