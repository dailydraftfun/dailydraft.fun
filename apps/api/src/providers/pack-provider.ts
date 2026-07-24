import type { Money, PackProviderMode } from '../domain.js';

export type DuelSide = 'creator' | 'opponent';

export interface GeneratePackInput {
  duelId: string;
  idempotencyKey: string;
  providerPackId: string;
  recipientWallet: string;
  side: DuelSide;
}

export interface GeneratedPack {
  providerReference: string;
  status: 'generated';
}

export interface OpenPackInput {
  idempotencyKey: string;
  providerReference: string;
}

export interface ProviderCardResult {
  assetReference: string;
  displayName: string;
  imageUrl?: string;
  insuredValue: Money;
  poolVersion: string;
  sourceTimestamp: string;
  valuationSourceReference?: string;
  valuationPolicyHash: string;
}

export const PROVIDER_RESPONSE_EVIDENCE_SCHEMA_VERSION =
  'openpacksduel.provider-response-evidence.v1';

export interface ProviderResponseEvidence {
  payloadHash: string;
  rawPayload: string;
  schemaVersion: typeof PROVIDER_RESPONSE_EVIDENCE_SCHEMA_VERSION;
  signature: string;
  signatureAlgorithm: string;
  signingKeyReference: string;
}

export interface OpenedProviderPackSnapshot {
  evidence: ProviderResponseEvidence;
  openedAt: string;
  providerReference: string;
  result: ProviderCardResult;
  status: 'opened';
}

export type ProviderPackSnapshot =
  | { providerReference: string; status: 'generated' | 'opening' }
  | { errorCode: string; providerReference: string; status: 'failed' }
  | OpenedProviderPackSnapshot;

export abstract class PackProvider {
  abstract readonly mode: PackProviderMode;

  abstract generatePack(input: GeneratePackInput): Promise<GeneratedPack>;
  abstract getPack(providerReference: string): Promise<ProviderPackSnapshot>;
  abstract openPack(input: OpenPackInput): Promise<ProviderPackSnapshot>;
  abstract verifyOpenedSnapshot(snapshot: OpenedProviderPackSnapshot): void;
}
