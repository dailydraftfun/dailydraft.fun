import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export const CRASH_SETTLEMENT_PROVIDER = Symbol('CRASH_SETTLEMENT_PROVIDER');
export const CRASH_SETTLEMENT_PROVIDER_FIXTURE_VERSION =
  'dailydraft.crash-settlement-provider-fixture.v1' as const;

export type CrashSettlementProviderOperationKind = 'liquidate' | 'open' | 'purchase' | 'transfer';

export interface CrashSettlementProviderRequest {
  amount: string;
  assetReference: string;
  currency: 'USDC';
  decimals: 6;
  destinationReference: string;
  kind: CrashSettlementProviderOperationKind;
  operationKey: string;
  providerRequestKey: string;
  requestHash: string;
  roundId: string;
  sequence: number;
  sourceReference: string;
  stage: number | null;
}

export interface CrashSettlementProviderResult {
  evidence: {
    providerRequestKey: string;
    schemaVersion: typeof CRASH_SETTLEMENT_PROVIDER_FIXTURE_VERSION;
  };
  finalized: true;
  resultHash: string;
  signature: string;
}

export abstract class CrashSettlementProvider {
  abstract execute(request: CrashSettlementProviderRequest): Promise<CrashSettlementProviderResult>;

  abstract reconcile(
    request: CrashSettlementProviderRequest,
  ): Promise<CrashSettlementProviderResult | null>;
}

export class CrashSettlementDefinitelyNotAppliedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CrashSettlementDefinitelyNotAppliedError';
  }
}

export class CrashSettlementAmbiguousError extends Error {
  constructor(
    readonly code: string,
    readonly signature: string | null = null,
  ) {
    super(code);
    this.name = 'CrashSettlementAmbiguousError';
  }
}

/**
 * Synthetic provider used only behind Crash fixture mode. It records keyed
 * effects in memory so ordinary retries reconcile before executing. Failure
 * and restart vectors inject a durable scripted provider in tests.
 */
@Injectable()
export class DeterministicCrashSettlementFixtureProvider extends CrashSettlementProvider {
  readonly #results = new Map<string, CrashSettlementProviderResult>();

  async execute(request: CrashSettlementProviderRequest): Promise<CrashSettlementProviderResult> {
    const existing = this.#results.get(request.providerRequestKey);
    if (existing) return existing;
    const signature = `fixture-signature:${sha256(request.providerRequestKey).slice(0, 40)}`;
    const result: CrashSettlementProviderResult = {
      evidence: {
        providerRequestKey: request.providerRequestKey,
        schemaVersion: CRASH_SETTLEMENT_PROVIDER_FIXTURE_VERSION,
      },
      finalized: true,
      resultHash: sha256(`${request.requestHash}:${signature}`),
      signature,
    };
    this.#results.set(request.providerRequestKey, result);
    return result;
  }

  async reconcile(
    request: CrashSettlementProviderRequest,
  ): Promise<CrashSettlementProviderResult | null> {
    return this.#results.get(request.providerRequestKey) ?? null;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
