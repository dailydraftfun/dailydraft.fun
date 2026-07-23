import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { OpenedProviderPackSnapshot } from './pack-provider.js';
import {
  assertProviderResponseEvidence,
  createProviderResponseEvidence,
  rawProviderResponsePayload,
} from './provider-response-evidence.js';
import { compareInsuredValues, normalizeProviderResult } from './provider-result.js';
import { CANONICAL_VALUATION_POLICY_HASH } from './valuation-policy.js';

describe('provider response evidence', () => {
  test('binds a bounded raw signed payload to every opened result field', () => {
    const snapshot = openedSnapshot();

    expect(() =>
      assertProviderResponseEvidence(snapshot, signature(snapshot.evidence.rawPayload)),
    ).not.toThrow();
    expect(snapshot.evidence.payloadHash).toBe(
      createHash('sha256').update(snapshot.evidence.rawPayload).digest('hex'),
    );
  });

  test('rejects payload, hash, signature, schema, and metadata drift', () => {
    const snapshot = openedSnapshot();
    const variants: OpenedProviderPackSnapshot[] = [
      { ...snapshot, openedAt: new Date(1).toISOString() },
      {
        ...snapshot,
        evidence: { ...snapshot.evidence, payloadHash: '0'.repeat(64) },
      },
      {
        ...snapshot,
        evidence: { ...snapshot.evidence, signature: '0'.repeat(64) },
      },
      {
        ...snapshot,
        evidence: {
          ...snapshot.evidence,
          schemaVersion: 'unsupported' as never,
        },
      },
      {
        ...snapshot,
        evidence: {
          ...snapshot.evidence,
          signatureAlgorithm: '\ninvalid',
        },
      },
    ];

    for (const variant of variants) {
      expect(() =>
        assertProviderResponseEvidence(variant, signature(variant.evidence.rawPayload)),
      ).toThrow();
    }
  });

  test('rejects an oversized raw response before signature comparison', () => {
    const snapshot = openedSnapshot();
    const rawPayload = 'x'.repeat(32 * 1024 + 1);
    expect(() =>
      assertProviderResponseEvidence(
        {
          ...snapshot,
          evidence: createProviderResponseEvidence({
            rawPayload,
            signature: signature(rawPayload),
            signatureAlgorithm: 'sha256-fixture',
            signingKeyReference: 'fixture-key-v1',
          }),
        },
        signature(rawPayload),
      ),
    ).toThrow('does not match');
  });

  test('conforms inventory, alternate-recipient open, result, winner-history, and outage fixtures', () => {
    const fixture = providerContractFixture();
    expect(fixture.inventory).toHaveLength(2);
    expect(new Set(fixture.inventory.map(({ assetReference }) => assetReference)).size).toBe(2);
    expect(
      fixture.openRequests.every(
        ({ recipientWallet }) => recipientWallet === fixture.escrowRecipient,
      ),
    ).toBe(true);
    expect(
      new Set(fixture.openRequests.map(({ openIdempotencyKey }) => openIdempotencyKey)).size,
    ).toBe(2);

    const observedAt = new Date('2026-07-23T20:00:00.000Z');
    const outcomes = fixture.results.map((result) => {
      const snapshot = fixtureSnapshot(result, observedAt.toISOString());
      assertProviderResponseEvidence(snapshot, signature(snapshot.evidence.rawPayload));
      return normalizeProviderResult(
        result.side,
        snapshot.result,
        CANONICAL_VALUATION_POLICY_HASH,
        result.providerReference,
        observedAt,
      );
    });
    const creator = outcomes.find((outcome) => outcome.side === 'creator');
    const opponent = outcomes.find((outcome) => outcome.side === 'opponent');
    if (!creator || !opponent) throw new Error('Fixture results require both sides');
    const creatorFixture = fixture.results.find(({ side }) => side === 'creator');
    const opponentFixture = fixture.results.find(({ side }) => side === 'opponent');
    if (!creatorFixture || !opponentFixture) {
      throw new Error('Contract fixture requires both provider references');
    }
    const comparison = compareInsuredValues(creator, opponent, {
      creatorWallet: 'fixture-creator-wallet',
      duelId: fixture.duelId,
      escrowAddress: fixture.escrowRecipient,
      network: 'solana-devnet',
      opponentWallet: 'fixture-opponent-wallet',
      providerMode: 'mock',
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    });

    expect(comparison.winnerSide).toBe(fixture.winnerHistory.winnerSide);
    expect(fixture.winnerHistory.creatorProviderReference).toBe(
      creatorFixture.providerReference,
    );
    expect(fixture.winnerHistory.opponentProviderReference).toBe(
      opponentFixture.providerReference,
    );
    expect(fixture.winnerHistory.settlementAllowedAfterBothResults).toBe(true);
    expect(fixture.outage).toEqual({
      ambiguousSide: 'opponent',
      recoveryStatus: 'RECOVERY_REQUIRED',
      reuseOpenIdempotencyKey: 'fixture-duel:opponent:open',
      settlementAllowed: false,
    });
  });
});

function openedSnapshot(): OpenedProviderPackSnapshot {
  const unsigned = {
    openedAt: '2026-07-23T20:00:00.000Z',
    providerReference: 'fixture-provider-reference',
    result: {
      assetReference: 'fixture-asset',
      displayName: 'Fixture card',
      insuredValue: {
        amount: '50000000',
        currency: 'USDC' as const,
        decimals: 6 as const,
      },
      poolVersion: 'fixture-pool-v1',
      sourceTimestamp: '2026-07-23T20:00:00.000Z',
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    },
    status: 'opened' as const,
  };
  const rawPayload = rawProviderResponsePayload(unsigned);
  return {
    ...unsigned,
    evidence: createProviderResponseEvidence({
      rawPayload,
      signature: signature(rawPayload),
      signatureAlgorithm: 'sha256-fixture',
      signingKeyReference: 'fixture-key-v1',
    }),
  };
}

function signature(rawPayload: string): string {
  return createHash('sha256').update(`fixture:${rawPayload}`).digest('hex');
}

interface ProviderContractFixture {
  duelId: string;
  escrowRecipient: string;
  inventory: Array<{ assetReference: string }>;
  openRequests: Array<{
    openIdempotencyKey: string;
    recipientWallet: string;
  }>;
  outage: {
    ambiguousSide: 'opponent';
    recoveryStatus: 'RECOVERY_REQUIRED';
    reuseOpenIdempotencyKey: string;
    settlementAllowed: false;
  };
  results: Array<{
    assetReference: string;
    displayName: string;
    insuredValueAmount: string;
    providerReference: string;
    side: 'creator' | 'opponent';
  }>;
  winnerHistory: {
    creatorProviderReference: string;
    opponentProviderReference: string;
    settlementAllowedAfterBothResults: boolean;
    winnerSide: 'creator' | 'opponent';
  };
}

function providerContractFixture(): ProviderContractFixture {
  return JSON.parse(
    readFileSync(new URL('./fixtures/provider-escrow-contract.v1.json', import.meta.url), 'utf8'),
  ) as ProviderContractFixture;
}

function fixtureSnapshot(
  result: ProviderContractFixture['results'][number],
  openedAt: string,
): OpenedProviderPackSnapshot {
  const unsigned = {
    openedAt,
    providerReference: result.providerReference,
    result: {
      assetReference: result.assetReference,
      displayName: result.displayName,
      insuredValue: {
        amount: result.insuredValueAmount,
        currency: 'USDC' as const,
        decimals: 6 as const,
      },
      poolVersion: 'fixture-pool-v1',
      sourceTimestamp: '2026-07-23T19:59:30.000Z',
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    },
    status: 'opened' as const,
  };
  const rawPayload = rawProviderResponsePayload(unsigned);
  return {
    ...unsigned,
    evidence: createProviderResponseEvidence({
      rawPayload,
      signature: signature(rawPayload),
      signatureAlgorithm: 'sha256-fixture',
      signingKeyReference: 'fixture-key-v1',
    }),
  };
}
