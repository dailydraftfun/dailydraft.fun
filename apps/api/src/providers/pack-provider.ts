import type { Money } from '../domain.js';

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
  insuredValue: Money;
  valuationPolicyHash: string;
}

export type ProviderPackSnapshot =
  | { providerReference: string; status: 'generated' | 'opening' }
  | { errorCode: string; providerReference: string; status: 'failed' }
  | {
      providerReference: string;
      result: ProviderCardResult;
      status: 'opened';
    };

export abstract class PackProvider {
  abstract readonly mode: 'collector-crypt-sandbox' | 'mock';

  abstract generatePack(input: GeneratePackInput): Promise<GeneratedPack>;
  abstract getPack(providerReference: string): Promise<ProviderPackSnapshot>;
  abstract openPack(input: OpenPackInput): Promise<ProviderPackSnapshot>;
}
