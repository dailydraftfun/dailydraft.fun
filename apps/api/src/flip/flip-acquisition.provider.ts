import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export const FLIP_ACQUISITION_PROVIDER = Symbol('FLIP_ACQUISITION_PROVIDER');
export const FLIP_ACQUISITION_PROVIDER_FIXTURE_VERSION =
  'dailydraft.flip-acquisition-provider-fixture.v1' as const;

export type FlipAcquisitionOperationKind = 'purchase' | 'transfer';

export interface FlipAcquisitionProviderRequest {
  amount: string;
  assetReference: string;
  currency: 'USDC';
  decimals: 6;
  destinationReference: string;
  kind: FlipAcquisitionOperationKind;
  listingReference: string;
  operationKey: string;
  providerRequestKey: string;
  requestHash: string;
  sessionReference: string;
  sourceReference: string;
}

export interface FlipAcquisitionProviderResult {
  evidence: {
    providerRequestKey: string;
    schemaVersion: typeof FLIP_ACQUISITION_PROVIDER_FIXTURE_VERSION;
  };
  finalized: true;
  providerReference: string;
  resultHash: string;
}

export abstract class FlipAcquisitionProvider {
  abstract execute(request: FlipAcquisitionProviderRequest): Promise<FlipAcquisitionProviderResult>;

  abstract reconcile(
    request: FlipAcquisitionProviderRequest,
    knownProviderReference: string | null,
  ): Promise<FlipAcquisitionProviderResult | null>;
}

export class FlipAcquisitionDefinitelyNotAppliedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FlipAcquisitionDefinitelyNotAppliedError';
  }
}

export class FlipAcquisitionAmbiguousError extends Error {
  constructor(
    readonly code: string,
    readonly providerReference: string | null = null,
  ) {
    super(code);
    this.name = 'FlipAcquisitionAmbiguousError';
  }
}

/**
 * Non-signing fixture provider. Effects are keyed before execution so retries
 * reconcile the same synthetic result and never create another purchase or
 * transfer.
 */
@Injectable()
export class DeterministicFlipAcquisitionFixtureProvider extends FlipAcquisitionProvider {
  async execute(request: FlipAcquisitionProviderRequest): Promise<FlipAcquisitionProviderResult> {
    return fixtureResult(request);
  }

  async reconcile(
    request: FlipAcquisitionProviderRequest,
    knownProviderReference: string | null,
  ): Promise<FlipAcquisitionProviderResult | null> {
    const result = fixtureResult(request);
    return knownProviderReference === result.providerReference ? result : null;
  }
}

function fixtureResult(request: FlipAcquisitionProviderRequest): FlipAcquisitionProviderResult {
  const providerReference = `fixture-provider:${sha256(request.providerRequestKey).slice(0, 40)}`;
  return Object.freeze({
    evidence: Object.freeze({
      providerRequestKey: request.providerRequestKey,
      schemaVersion: FLIP_ACQUISITION_PROVIDER_FIXTURE_VERSION,
    }),
    finalized: true as const,
    providerReference,
    resultHash: sha256(`${request.requestHash}:${providerReference}`),
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
