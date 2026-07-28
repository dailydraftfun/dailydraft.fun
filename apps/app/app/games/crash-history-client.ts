import {
  CRASH_HISTORY_SCHEMA_VERSION,
  CRASH_RECEIPT_SCHEMA_VERSION,
  type CrashHistoryItem,
  type CrashHistoryPage,
  type CrashReceipt,
  type CrashReceiptEvent,
  type CrashSafeNextAction,
  compareCrashReceiptEvents,
  isCrashReceiptEventId,
} from '@dailydraft/contracts/crash-history';

const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');
const CURSOR_PATTERN = /^v1\.[A-Za-z0-9_-]{1,480}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ROUND_PATTERN = /^crashround_[A-Za-z0-9._:-]{8,128}$/;

export class CrashHistoryUnavailableError extends Error {
  constructor() {
    super('The Crash history API is not configured.');
    this.name = 'CrashHistoryUnavailableError';
  }
}

export async function getCrashHistory(
  sessionToken: string,
  cursor: string | null = null,
  signal?: AbortSignal,
  baseUrl: string | undefined = apiBaseUrl,
  fetcher: typeof fetch = fetch,
): Promise<CrashHistoryPage> {
  if (!baseUrl) throw new CrashHistoryUnavailableError();
  const query = new URLSearchParams({ limit: '10' });
  if (cursor) query.set('cursor', cursor);
  const response = await fetcher(`${baseUrl}/crash/rounds?${query}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${sessionToken}` },
    signal,
  });
  if (!response.ok) throw new Error(`Crash history is unavailable (${response.status}).`);
  return parseCrashHistoryPage(await response.json());
}

export async function getCrashReceipt(
  roundId: string,
  sessionToken: string,
  signal?: AbortSignal,
  baseUrl: string | undefined = apiBaseUrl,
  fetcher: typeof fetch = fetch,
): Promise<CrashReceipt> {
  if (!baseUrl) throw new CrashHistoryUnavailableError();
  if (!ROUND_PATTERN.test(roundId)) throw malformedCrashError();
  const response = await fetcher(`${baseUrl}/crash/rounds/${encodeURIComponent(roundId)}/receipt`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${sessionToken}` },
    signal,
  });
  if (!response.ok) throw new Error(`Crash receipt is unavailable (${response.status}).`);
  return parseCrashReceipt(await response.json());
}

export function parseCrashHistoryPage(value: unknown): CrashHistoryPage {
  if (!isObject(value) || hasSensitiveKey(value)) throw malformedCrashError();
  if (
    value.schemaVersion !== CRASH_HISTORY_SCHEMA_VERSION ||
    !Array.isArray(value.data) ||
    value.data.length > 50 ||
    typeof value.hasMore !== 'boolean' ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === 'string' && CURSOR_PATTERN.test(value.nextCursor))
    )
  ) {
    throw malformedCrashError();
  }
  const data = value.data.map(parseHistoryItem);
  if (new Set(data.map(({ roundId }) => roundId)).size !== data.length) {
    throw malformedCrashError();
  }
  for (let index = 1; index < data.length; index += 1) {
    const previous = data[index - 1];
    const current = data[index];
    if (
      !previous ||
      !current ||
      previous.createdAt < current.createdAt ||
      (previous.createdAt === current.createdAt && previous.roundId < current.roundId)
    ) {
      throw malformedCrashError();
    }
  }
  return {
    data,
    hasMore: value.hasMore,
    nextCursor: value.nextCursor,
    schemaVersion: CRASH_HISTORY_SCHEMA_VERSION,
  };
}

export function parseCrashReceipt(value: unknown): CrashReceipt {
  if (!isObject(value) || hasSensitiveKey(value)) throw malformedCrashError();
  if (
    value.schemaVersion !== CRASH_RECEIPT_SCHEMA_VERSION ||
    !ROUND_PATTERN.test(String(value.roundId)) ||
    value.mode !== 'fixture-preview' ||
    value.network !== 'solana-devnet' ||
    !isStatus(value.status) ||
    !Number.isInteger(value.stage) ||
    Number(value.stage) < 1 ||
    !Number.isInteger(value.version) ||
    Number(value.version) < 1 ||
    !isIso(value.createdAt) ||
    !isIso(value.updatedAt) ||
    !isDeadline(value.decisionDeadline, value.status) ||
    !(value.terminalAt === null || isIso(value.terminalAt)) ||
    !(value.terminalReason === null || typeof value.terminalReason === 'string') ||
    !isMoney(value.pot) ||
    !isResolution(value.resolution, value.status, value.settlement) ||
    !isSafeNextAction(value.safeNextAction) ||
    !isObject(value.privacy) ||
    value.privacy.exposesProviderSignatures !== false ||
    value.privacy.exposesWalletAddresses !== false ||
    !isObject(value.finality) ||
    value.finality.gameState !== 'committed' ||
    !isSettlementStatus(value.finality.settlement) ||
    !['not-final', 'recovery-required', 'settled'].includes(String(value.finality.custody)) ||
    !isObject(value.custody) ||
    !['not-started', 'prepared', 'recovery-required'].includes(String(value.custody.status)) ||
    !nonNegativeInteger(value.custody.preparedIntentCount) ||
    !nonNegativeInteger(value.custody.recoveryRequiredIntentCount) ||
    !isSettlement(value.settlement) ||
    !isBindings(value.bindings) ||
    !Array.isArray(value.events)
  ) {
    throw malformedCrashError();
  }
  const events = value.events.map(parseEvent);
  if (new Set(events.map(({ eventId }) => eventId)).size !== events.length) {
    throw malformedCrashError();
  }
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (!previous || !current || compareCrashReceiptEvents(previous, current) > 0) {
      throw malformedCrashError();
    }
  }
  return { ...(value as unknown as CrashReceipt), events };
}

function parseHistoryItem(value: unknown): CrashHistoryItem {
  if (
    !isObject(value) ||
    !ROUND_PATTERN.test(String(value.roundId)) ||
    !isIso(value.createdAt) ||
    !isIso(value.updatedAt) ||
    !Number.isInteger(value.currentStage) ||
    Number(value.currentStage) < 1 ||
    !isMoney(value.pot) ||
    !isSafeNextAction(value.safeNextAction) ||
    value.receiptHref !== `/v1/crash/rounds/${value.roundId}/receipt` ||
    !(value.terminalReason === null || typeof value.terminalReason === 'string') ||
    !isObject(value.gameState) ||
    value.gameState.committed !== true ||
    !isStatus(value.gameState.status) ||
    !isDeadline(value.decisionDeadline, value.gameState.status) ||
    !isResolution(value.resolution, value.gameState.status, value.settlement) ||
    !Number.isInteger(value.gameState.version) ||
    Number(value.gameState.version) < 1 ||
    !isObject(value.settlement) ||
    !isSettlementStatus(value.settlement.status) ||
    !nonNegativeInteger(value.settlement.finalizedOperationCount) ||
    !(
      value.settlement.receiptHash === null ||
      HASH_PATTERN.test(String(value.settlement.receiptHash))
    )
  ) {
    throw malformedCrashError();
  }
  return value as unknown as CrashHistoryItem;
}

function parseEvent(value: unknown): CrashReceiptEvent {
  const kind = value && isObject(value) ? value.kind : null;
  if (
    !isObject(value) ||
    ![
      'custody-prepared',
      'custody-recovery-required',
      'deadline-defaulted',
      'round-busted',
      'round-cashed-out',
      'round-completed',
      'round-started',
      'settlement-finalized',
      'settlement-prepared',
      'settlement-recovery-required',
      'stage-continued',
    ].includes(String(kind)) ||
    !isCrashReceiptEventId(value.eventId, kind as CrashReceiptEvent['kind']) ||
    !isIso(value.occurredAt) ||
    typeof value.reference !== 'string' ||
    !/^crashref_[a-f0-9]{32}$/.test(value.reference) ||
    !isScheduledDeadline(value.scheduledDeadline, value.kind) ||
    !Number.isInteger(value.stage) ||
    Number(value.stage) < 1 ||
    !(value.amount === null || isMoney(value.amount)) ||
    !(
      value.decision === null ||
      ['cash-out', 'continue', 'forfeit'].includes(String(value.decision))
    ) ||
    !(value.terminalReason === null || typeof value.terminalReason === 'string')
  ) {
    throw malformedCrashError();
  }
  return value as unknown as CrashReceiptEvent;
}

function isSettlement(value: unknown): value is CrashReceipt['settlement'] {
  return (
    isObject(value) &&
    nonNegativeInteger(value.expectedOperationCount) &&
    nonNegativeInteger(value.finalizedOperationCount) &&
    Number(value.finalizedOperationCount) <= Number(value.expectedOperationCount) &&
    isSettlementStatus(value.status) &&
    (value.receiptHash === null || HASH_PATTERN.test(String(value.receiptHash))) &&
    (value.recoveryReason === null || typeof value.recoveryReason === 'string')
  );
}

function isBindings(value: unknown): value is CrashReceipt['bindings'] {
  if (!isObject(value)) return false;
  return (
    [
      'architectureVersion',
      'calculatorVersion',
      'riskRulesVersion',
      'rulesVersion',
      'stateMachineVersion',
    ].every((key) => typeof value[key] === 'string') &&
    ['riskRulesHash', 'rulesHash', 'stateMachineRulesHash'].every((key) =>
      HASH_PATTERN.test(String(value[key])),
    ) &&
    ['custodyPolicyHash', 'inventoryPolicyHash', 'settlementPolicyHash'].every(
      (key) => value[key] === null || HASH_PATTERN.test(String(value[key])),
    ) &&
    ['custodyPolicyVersion', 'inventoryPolicyVersion', 'settlementPolicyVersion'].every(
      (key) => value[key] === null || typeof value[key] === 'string',
    )
  );
}

function isMoney(value: unknown): value is CrashReceipt['pot'] {
  return (
    isObject(value) &&
    typeof value.amount === 'string' &&
    /^(0|[1-9][0-9]{0,19})$/.test(value.amount) &&
    value.currency === 'USDC' &&
    value.decimals === 6
  );
}

function isStatus(value: unknown): value is CrashReceipt['status'] {
  return ['active', 'busted', 'cashed-out', 'completed', 'defaulted'].includes(String(value));
}

function isSettlementStatus(value: unknown): value is CrashReceipt['settlement']['status'] {
  return ['not-required', 'pending', 'recovery-required', 'settled'].includes(String(value));
}

function isSafeNextAction(value: unknown): value is CrashSafeNextAction {
  return [
    'choose-action',
    'reconnect',
    'retry-settlement',
    'review-receipt',
    'wait-for-settlement',
  ].includes(String(value));
}

function isDeadline(value: unknown, status: unknown): value is string | null {
  return status === 'active' ? isIso(value) : value === null;
}

function isScheduledDeadline(value: unknown, kind: unknown): value is string | null {
  if (
    ['custody-prepared', 'custody-recovery-required'].includes(String(kind)) ||
    String(kind).startsWith('settlement-')
  ) {
    return value === null;
  }
  return value === null || isIso(value);
}

function isResolution(
  value: unknown,
  status: unknown,
  settlement: unknown,
): value is CrashReceipt['resolution'] {
  if (!isObject(settlement) || !isSettlementStatus(settlement.status)) return false;
  if (value === 'active') return status === 'active' && settlement.status === 'not-required';
  if (value === 'recovering') {
    return status !== 'active' && ['pending', 'recovery-required'].includes(settlement.status);
  }
  if (value === 'disputed' || value === 'failed') {
    return status !== 'active' && settlement.status === 'recovery-required';
  }
  if (value === 'refunded') return status !== 'active' && settlement.status === 'settled';
  if (value === 'bust') return status === 'busted' && settlement.status === 'settled';
  if (value === 'timed-out') return status === 'defaulted' && settlement.status === 'settled';
  return (
    value === 'cash-out' &&
    (status === 'cashed-out' || status === 'completed') &&
    settlement.status === 'settled'
  );
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function hasSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      [
        'destinationReference',
        'playerWalletReference',
        'providerEvidence',
        'providerSignature',
        'requestedRecipient',
        'sourceReference',
        'sourceWalletReference',
      ].includes(key) || hasSensitiveKey(nested),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformedCrashError(): Error {
  return new Error('The Crash API returned a malformed private history receipt.');
}
