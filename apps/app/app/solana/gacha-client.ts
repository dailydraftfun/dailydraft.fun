/**
 * Transport for the Sports Pack Gacha rail.
 *
 * Mirrors `duel-client.ts` deliberately — same base-URL guard, same injectable
 * `fetcher`, same RFC-7807 unwrapping — with two differences that come straight
 * from the controller:
 *
 * - `gacha.controller.ts` carries no `@UseGuards`, so none of these helpers take
 *   a session token. A rip is authorised by a verified on-chain payment, not by
 *   a bearer credential.
 * - Only `POST /gacha/rips` reads an `idempotency-key` header, so the mutation
 *   helper treats it as optional rather than required.
 */

export type GachaProviderMode = string;

export type GachaCapabilityGates = {
  acquisition: boolean;
  odds: boolean;
  provider: boolean;
  settlement: boolean;
};

export type GachaCapability = {
  availability: 'playable' | 'preview';
  gates: GachaCapabilityGates;
  /**
   * Intentionally widened to `string`.
   *
   * `openapi.yaml` still enumerates this as `[collector-crypt, fixture]` and has
   * not been extended with `dailydraft-devnet`, which is exactly the mode this
   * surface runs in. Narrowing here would make the client reject the only
   * deployment it is built for, so the enum gap is reported against the spec
   * rather than enforced against the server.
   */
  providerMode: GachaProviderMode;
  reason: string;
};

export type GachaSport = 'BASEBALL' | 'BASKETBALL' | 'FOOTBALL' | 'SOCCER';

export type GachaInventoryEntry = {
  assetReference: string | null;
  displayName: string;
  eligible: boolean;
  exclusionReasons: string[];
  graded: boolean;
  graderReference: string | null;
  id: string;
  insuredValueCurrency: 'USDC';
  insuredValueDecimals: 6;
  insuredValueMinor: string | null;
  insuredValueProviderReference: string | null;
  inventorySourceTimestamp: string | null;
  ordinal: number;
  poolOpen: boolean;
  providerCardReference: string;
  snapshotId: string;
  sport: GachaSport;
  tierEnabled: boolean;
  valuationSourceReference: string | null;
  valuationTimestamp: string | null;
};

export type GachaMachine = {
  active: boolean;
  committedPoolSize: number;
  displayName: string;
  id: string;
  machineKey: string;
  sport: GachaSport;
  tierPriceCurrency: 'USDC';
  tierPriceDecimals: 6;
  tierPriceMinor: string;
};

export type GachaInventorySnapshot = {
  committedPoolSize: number;
  contentHash: string;
  eligibleCount: number;
  eligibleValueMinor: string;
  entries: GachaInventoryEntry[];
  evaluatedAt: string;
  excludedCount: number;
  id: string;
  machine: GachaMachine;
  machineKey: string;
  policyHash: string;
  policyVersion: string;
  poolKey: string;
  provider: string;
  revision: number;
  schemaVersion: string;
  sealedAt: string | null;
};

export type GachaOddsCommitment = {
  /**
   * Server-committed rarity bands, keyed by band label with the minimum insured
   * value in USDC minor units. This is what the reveal keys its tier off, so a
   * card's rarity is the one the house sealed before the roll rather than a
   * threshold the browser invented.
   */
  bandMinimums: Record<string, string>;
  baseProbabilityPpm: number;
  calculatorVersion: string;
  chaseProbabilityPpm: number;
  committedAt: string;
  id: string;
  machineKey: string;
  oddsKey: string;
  plusProbabilityPpm: number;
  premiumProbabilityPpm: number;
  probabilityScalePpm: number;
  rulesHash: string;
  schemaVersion: string;
  sealedAt: string | null;
  snapshotContentHash: string;
  version: number;
};

export type GachaSeedCommitment = {
  commitmentId: string;
  expiresAt: string;
  serverSeedHash: string;
};

export type GachaPaymentIntent = {
  amountCurrency: 'USDC';
  amountDecimals: 6;
  amountMinor: string;
  destinationTokenAccount: string;
  expiresAt: string;
  intentId: string;
  machineKey: string;
  memoNonce: string;
  mint: string;
  payerWallet: string;
  resumed: boolean;
  signature: string | null;
  status: 'PENDING' | 'VERIFIED';
};

export type PreparedGachaPaymentTransaction = {
  amountMinor: string;
  /** sha256 of the compiled message, so a wallet can detect tampering. */
  expectedMessageHash: string;
  expiresAt: string;
  intentId: string;
  lastValidBlockHeight: string;
  memoNonce: string;
  recentBlockhash: string;
  serializedTransactionBase64: string;
  sourceTokenAccount: string;
};

export type VerifiedGachaPayment = {
  amountMinor: string;
  intentId: string;
  /**
   * False when the payment landed through a bare SPL `transfer`, which carries
   * no mint account. The server still checks the destination token account, so
   * this reports how the mint was established rather than whether it was.
   */
  mintVerifiedOnChain: boolean;
  signature: string;
  verifiedAt: string;
};

export type GachaRipStatus = 'ACQUIRED' | 'FAILED' | 'REVEALED' | 'SELECTED' | 'SETTLED';

export type GachaRip = {
  acquiredAt: string | null;
  acquisitionReference: string | null;
  createdAt: string;
  failedAssetReference: string | null;
  failedAt: string | null;
  failureReason: string | null;
  id: string;
  idempotencyKey: string | null;
  insuredValueCurrency: 'USDC';
  insuredValueDecimals: 6;
  insuredValueMinor: string;
  machineKey: string;
  oddsCommitmentId: string;
  oddsRulesHash: string;
  revealedAt: string | null;
  seedCommitmentHash: string;
  /**
   * Cleared back to `null` when the provider fails after selection, which
   * returns the asset to the eligible pool. `failedAssetReference` keeps the
   * audit trail of what the rip had picked.
   */
  selectedAssetReference: string | null;
  selectedAt: string;
  settledAt: string | null;
  settlementReference: string | null;
  snapshotContentHash: string;
  status: GachaRipStatus;
  updatedAt: string;
};

export type GachaRipResult = {
  oddsCommitment: {
    calculatorVersion: string;
    committedAt: string;
    oddsKey: string;
    rulesHash: string;
    schemaVersion: string;
    snapshotContentHash: string;
    version: number;
  };
  rip: GachaRip;
  /** Revealed only once the rip is terminal, so the roll can be re-derived. */
  serverSeed: string | null;
  serverSeedHash: string | null;
};

export type CreateGachaRipInput = {
  commitmentId: string;
  machineKey: string;
  oddsVersion?: number;
  paymentIntentId?: string;
  recipientWallet: string;
  seed: string;
};

// The gacha rail is served by the same API as duels, so it reads the same base
// URL rather than introducing a second env var deployments would have to keep
// in step.
const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');

export async function getGachaCapability(signal?: AbortSignal): Promise<GachaCapability> {
  return requestGachaCapability(requireApiBaseUrl(), signal);
}

export async function getGachaInventory(
  machineKey: string,
  signal?: AbortSignal,
): Promise<GachaInventorySnapshot> {
  return requestGachaInventory(requireApiBaseUrl(), machineKey, signal);
}

export async function getGachaOdds(
  machineKey: string,
  signal?: AbortSignal,
): Promise<GachaOddsCommitment> {
  return requestGachaOdds(requireApiBaseUrl(), machineKey, signal);
}

export async function createGachaSeedCommitment(
  machineKey: string,
  sessionToken: string | null,
): Promise<GachaSeedCommitment> {
  return requestGachaSeedCommitment(requireApiBaseUrl(), machineKey, sessionToken);
}

export async function createGachaPaymentIntent(
  machineKey: string,
  payerWallet: string,
  sessionToken: string | null,
): Promise<GachaPaymentIntent> {
  return requestGachaPaymentIntent(requireApiBaseUrl(), machineKey, payerWallet, sessionToken);
}

export async function prepareGachaPaymentTransaction(
  intentId: string,
  sessionToken: string | null,
): Promise<PreparedGachaPaymentTransaction> {
  return requestPreparedGachaPaymentTransaction(requireApiBaseUrl(), intentId, sessionToken);
}

export async function claimGachaPaymentSignature(
  intentId: string,
  signedTransactionBase64: string,
  sessionToken: string | null,
): Promise<GachaPaymentIntent> {
  return requestClaimedGachaPaymentSignature(
    requireApiBaseUrl(),
    intentId,
    signedTransactionBase64,
    sessionToken,
  );
}

export async function verifyGachaPayment(
  intentId: string,
  signature: string,
  sessionToken: string | null,
): Promise<VerifiedGachaPayment> {
  return requestVerifiedGachaPayment(requireApiBaseUrl(), intentId, signature, sessionToken);
}

export async function createGachaRip(
  input: CreateGachaRipInput,
  sessionToken: string | null,
): Promise<GachaRipResult> {
  return requestGachaRip(requireApiBaseUrl(), input, sessionToken);
}

export async function requestGachaCapability(
  baseUrl: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GachaCapability> {
  const response = await fetcher(`${baseUrl}/gacha/capability`, { cache: 'no-store', signal });
  return parseGachaCapability(await parseGachaResponse<unknown>(response));
}

export async function requestGachaInventory(
  baseUrl: string,
  machineKey: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GachaInventorySnapshot> {
  const response = await fetcher(
    `${baseUrl}/gacha/machines/${encodeURIComponent(machineKey)}/inventory`,
    { cache: 'no-store', signal },
  );
  return parseGachaResponse<GachaInventorySnapshot>(response);
}

export async function requestGachaOdds(
  baseUrl: string,
  machineKey: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GachaOddsCommitment> {
  const response = await fetcher(
    `${baseUrl}/gacha/machines/${encodeURIComponent(machineKey)}/odds`,
    { cache: 'no-store', signal },
  );
  return parseGachaResponse<GachaOddsCommitment>(response);
}

export async function requestGachaSeedCommitment(
  baseUrl: string,
  machineKey: string,
  sessionToken: string | null,
  fetcher: typeof fetch = fetch,
): Promise<GachaSeedCommitment> {
  return requestGachaMutation<GachaSeedCommitment>(
    baseUrl,
    `/gacha/machines/${encodeURIComponent(machineKey)}/rip-commitments`,
    {},
    undefined,
    sessionToken,
    fetcher,
  );
}

export async function requestGachaPaymentIntent(
  baseUrl: string,
  machineKey: string,
  payerWallet: string,
  sessionToken: string | null,
  fetcher: typeof fetch = fetch,
): Promise<GachaPaymentIntent> {
  return requestGachaMutation<GachaPaymentIntent>(
    baseUrl,
    `/gacha/machines/${encodeURIComponent(machineKey)}/payment-intents`,
    { payerWallet },
    undefined,
    sessionToken,
    fetcher,
  );
}

export async function requestPreparedGachaPaymentTransaction(
  baseUrl: string,
  intentId: string,
  sessionToken: string | null,
  fetcher: typeof fetch = fetch,
): Promise<PreparedGachaPaymentTransaction> {
  return requestGachaMutation<PreparedGachaPaymentTransaction>(
    baseUrl,
    `/gacha/payment-intents/${encodeURIComponent(intentId)}/transaction`,
    {},
    undefined,
    sessionToken,
    fetcher,
  );
}

export async function requestClaimedGachaPaymentSignature(
  baseUrl: string,
  intentId: string,
  signedTransactionBase64: string,
  sessionToken: string | null,
  fetcher: typeof fetch = fetch,
): Promise<GachaPaymentIntent> {
  return requestGachaMutation<GachaPaymentIntent>(
    baseUrl,
    `/gacha/payment-intents/${encodeURIComponent(intentId)}/signature`,
    { signedTransactionBase64 },
    undefined,
    sessionToken,
    fetcher,
  );
}

export async function requestVerifiedGachaPayment(
  baseUrl: string,
  intentId: string,
  signature: string,
  sessionToken: string | null,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedGachaPayment> {
  return requestGachaMutation<VerifiedGachaPayment>(
    baseUrl,
    `/gacha/payment-intents/${encodeURIComponent(intentId)}/verify`,
    { signature },
    undefined,
    sessionToken,
    fetcher,
  );
}

export async function requestGachaRip(
  baseUrl: string,
  input: CreateGachaRipInput,
  sessionToken: string | null,
  fetcher: typeof fetch = fetch,
): Promise<GachaRipResult> {
  const idempotencyKey = ripIdempotencyKey(input.commitmentId);
  return requestGachaMutation<GachaRipResult>(
    baseUrl,
    '/gacha/rips',
    {
      commitmentId: input.commitmentId,
      idempotencyKey,
      machineKey: input.machineKey,
      recipientWallet: input.recipientWallet,
      seed: input.seed,
      ...(input.oddsVersion === undefined ? {} : { oddsVersion: input.oddsVersion }),
      ...(input.paymentIntentId === undefined ? {} : { paymentIntentId: input.paymentIntentId }),
    },
    idempotencyKey,
    sessionToken,
    fetcher,
  );
}

/**
 * A seed commitment can only ever be consumed by one rip, so keying idempotency
 * off it makes a retried submit resolve to the same rip instead of burning the
 * commitment and failing.
 */
export function ripIdempotencyKey(commitmentId: string): string {
  return `opd-rip-${commitmentId}`;
}

export function parseGachaCapability(value: unknown): GachaCapability {
  if (!value || typeof value !== 'object') throw malformedCapabilityError();
  const candidate = value as Partial<GachaCapability>;
  if (
    (candidate.availability !== 'playable' && candidate.availability !== 'preview') ||
    typeof candidate.providerMode !== 'string' ||
    typeof candidate.reason !== 'string' ||
    !isCapabilityGates(candidate.gates)
  ) {
    throw malformedCapabilityError();
  }
  return candidate as GachaCapability;
}

/**
 * True only when the server reports every gate open.
 *
 * `availability` already folds the gates together, but the flip surface reads
 * both so a `playable` answer with a closed gate fails shut rather than sending
 * a player into a rip the server will refuse.
 */
export function isGachaRipAvailable(capability: GachaCapability): boolean {
  const { acquisition, odds, provider, settlement } = capability.gates;
  return capability.availability === 'playable' && acquisition && odds && provider && settlement;
}

export class GachaApiRequestError extends Error {
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GachaApiRequestError';
    this.retryable = status === 429 || status >= 500;
    this.status = status;
  }
}

export function isRetryableGachaRequestError(error: unknown): boolean {
  return error instanceof GachaApiRequestError ? error.retryable : true;
}

export function isTerminalGachaExecutionFailure(error: unknown): boolean {
  return (
    error instanceof GachaApiRequestError &&
    error.status === 409 &&
    error.message.includes('TRANSACTION_EXECUTION_ERROR')
  );
}

async function requestGachaMutation<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string | undefined,
  sessionToken: string | null,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${requireGachaSessionToken(sessionToken)}`,
      'content-type': 'application/json',
      // Only POST /gacha/rips reads this header; sending it everywhere would
      // imply a replay guarantee the other routes do not make.
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    method: 'POST',
  });
  return parseGachaResponse<T>(response);
}

async function parseGachaResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const detail = getProblemDetail(problem);
    throw new GachaApiRequestError(
      detail ?? `The Sports Pack Gacha request failed (${response.status}).`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

function requireApiBaseUrl(): string {
  if (!apiBaseUrl) throw new Error('The Sports Pack Gacha API is not configured.');
  return apiBaseUrl;
}

function requireGachaSessionToken(sessionToken: string | null): string {
  if (!sessionToken)
    throw new Error('Authenticate the connected wallet before opening a Sports Pack.');
  return sessionToken;
}

function isCapabilityGates(value: unknown): value is GachaCapabilityGates {
  if (!value || typeof value !== 'object') return false;
  const gates = value as Partial<GachaCapabilityGates>;
  return (
    typeof gates.acquisition === 'boolean' &&
    typeof gates.odds === 'boolean' &&
    typeof gates.provider === 'boolean' &&
    typeof gates.settlement === 'boolean'
  );
}

function malformedCapabilityError(): Error {
  return new Error('The Sports Pack Gacha capability response was malformed.');
}

function getProblemDetail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('detail' in value)) return undefined;
  return typeof value.detail === 'string' ? value.detail : undefined;
}
