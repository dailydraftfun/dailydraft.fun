import { createHash, createHmac } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  GeneratedPack,
  GeneratePackInput,
  OpenedProviderPackSnapshot,
  OpenPackInput,
  ProviderCardResult,
  ProviderPackSnapshot,
} from './pack-provider.js';
import { PackProvider } from './pack-provider.js';
import {
  assertProviderResponseEvidence,
  createProviderResponseEvidence,
  rawProviderResponsePayload,
} from './provider-response-evidence.js';
import { CANONICAL_VALUATION_POLICY_HASH } from './valuation-policy.js';

const MOCK_POOL_VERSION = 'openpacksduel.mock-pool.devnet.v1';
const MOCK_SIGNING_KEY = 'openpacksduel-fixture-only-provider-response-v1';
const CARD_NAMES = [
  'Devnet Charizard Test Card',
  'Devnet Pikachu Test Card',
  'Devnet Mew Test Card',
  'Devnet Blastoise Test Card',
] as const;

@Injectable()
export class MockPackProvider extends PackProvider {
  readonly mode = 'mock' as const;
  readonly #packs = new Map<string, ProviderPackSnapshot>();

  async generatePack(input: GeneratePackInput): Promise<GeneratedPack> {
    assertDevnetMockEnabled();
    const providerReference = `mock_pack_${input.side}_${digest(
      `${input.duelId}:${input.side}:${input.providerPackId}:${input.idempotencyKey}`,
    ).slice(0, 32)}`;
    if (!this.#packs.has(providerReference)) {
      this.#packs.set(providerReference, { providerReference, status: 'generated' });
    }
    return { providerReference, status: 'generated' };
  }

  async openPack(input: OpenPackInput): Promise<ProviderPackSnapshot> {
    assertDevnetMockEnabled();
    const current = this.#packs.get(input.providerReference);
    if (!current) throw new NotFoundException('Mock pack was not generated');
    if (current.status === 'opened') return current;

    const openedAt = new Date().toISOString();
    const result = createMockResult(input.providerReference, openedAt);
    const unsigned = {
      openedAt,
      providerReference: input.providerReference,
      result,
      status: 'opened',
    } as const;
    const rawPayload = rawProviderResponsePayload(unsigned);
    const opened: ProviderPackSnapshot = {
      ...unsigned,
      evidence: createProviderResponseEvidence({
        rawPayload,
        signature: fixtureSignature(rawPayload),
        signatureAlgorithm: 'hmac-sha256-fixture',
        signingKeyReference: 'openpacksduel-mock-fixture-v1',
      }),
    };
    this.#packs.set(input.providerReference, opened);
    return opened;
  }

  async getPack(providerReference: string): Promise<ProviderPackSnapshot> {
    assertDevnetMockEnabled();
    const snapshot = this.#packs.get(providerReference);
    if (!snapshot) throw new NotFoundException('Mock pack was not generated');
    return snapshot;
  }

  verifyOpenedSnapshot(snapshot: OpenedProviderPackSnapshot): void {
    assertProviderResponseEvidence(snapshot, fixtureSignature(snapshot.evidence.rawPayload));
  }
}

function createMockResult(providerReference: string, openedAt: string): ProviderCardResult {
  const hash = digest(providerReference);
  const numericSeed = Number.parseInt(hash.slice(0, 8), 16);
  // Side-specific parity allocates non-overlapping values, so a deterministic
  // mock duel cannot accidentally exercise an unresolved production tie rule.
  const parity = providerReference.startsWith('mock_pack_creator_') ? 0 : 1;
  const cents = 4_500 + (numericSeed % 1_000) * 2 + parity;
  return {
    assetReference: `mock_asset_${hash.slice(0, 40)}`,
    displayName: CARD_NAMES[numericSeed % CARD_NAMES.length] ?? CARD_NAMES[0],
    insuredValue: { amount: String(cents * 10_000), currency: 'USDC', decimals: 6 },
    poolVersion: MOCK_POOL_VERSION,
    sourceTimestamp: openedAt,
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  };
}

function assertDevnetMockEnabled(): void {
  const network = process.env.OPENPACKSDUEL_NETWORK ?? 'solana-devnet';
  if (network !== 'solana-devnet') {
    throw new ConflictException('The deterministic mock pack provider is devnet-only');
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureSignature(rawPayload: string): string {
  return createHmac('sha256', MOCK_SIGNING_KEY).update(rawPayload).digest('hex');
}
