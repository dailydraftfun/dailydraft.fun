import { afterEach, describe, expect, test } from 'bun:test';

import { CollectorCryptPackProvider } from './collector-crypt-pack.provider.js';
import { MockPackProvider } from './mock-pack.provider.js';

const originalNetwork = process.env.OPENPACKSDUEL_NETWORK;

describe('pack providers', () => {
  afterEach(() => {
    if (originalNetwork === undefined) delete process.env.OPENPACKSDUEL_NETWORK;
    else process.env.OPENPACKSDUEL_NETWORK = originalNetwork;
  });

  test('replays the same deterministic devnet mock pack', async () => {
    process.env.OPENPACKSDUEL_NETWORK = 'solana-devnet';
    const provider = new MockPackProvider();
    const input = {
      duelId: 'duel_test',
      idempotencyKey: 'duel_test:creator:generate',
      providerPackId: 'pokemon_50',
      recipientWallet: 'escrow-address',
      side: 'creator' as const,
    };

    const first = await provider.generatePack(input);
    const replay = await provider.generatePack(input);
    const opened = await provider.openPack({
      idempotencyKey: 'duel_test:creator:open',
      providerReference: first.providerReference,
    });
    const openedReplay = await provider.openPack({
      idempotencyKey: 'duel_test:creator:open',
      providerReference: first.providerReference,
    });

    expect(replay.providerReference).toBe(first.providerReference);
    expect(opened.status).toBe('opened');
    expect(openedReplay).toEqual(opened);
    expect(await provider.getPack(first.providerReference)).toEqual(opened);
    if (opened.status !== 'opened') throw new Error('Expected opened fixture evidence');
    provider.verifyOpenedSnapshot(opened);
    expect(() =>
      provider.verifyOpenedSnapshot({
        ...opened,
        evidence: { ...opened.evidence, signature: '0'.repeat(64) },
      }),
    ).toThrow('signature is invalid');
  });

  test('rejects mock operations outside devnet', async () => {
    process.env.OPENPACKSDUEL_NETWORK = 'solana-mainnet';
    const provider = new MockPackProvider();

    expect(
      provider.generatePack({
        duelId: 'duel_test',
        idempotencyKey: 'generate',
        providerPackId: 'pokemon_50',
        recipientWallet: 'escrow-address',
        side: 'creator',
      }),
    ).rejects.toThrow('devnet-only');
  });

  test('keeps Collector Crypt live operations fail-closed', async () => {
    const provider = new CollectorCryptPackProvider();

    expect(
      provider.generatePack({
        duelId: 'duel_test',
        idempotencyKey: 'generate',
        providerPackId: 'pokemon_50',
        recipientWallet: 'escrow-address',
        side: 'creator',
      }),
    ).rejects.toThrow('partner API contract is confirmed');
    expect(() =>
      provider.verifyOpenedSnapshot({
        evidence: {
          payloadHash: '0'.repeat(64),
          rawPayload: '{}',
          schemaVersion: 'openpacksduel.provider-response-evidence.v1',
          signature: '0'.repeat(64),
          signatureAlgorithm: 'fixture',
          signingKeyReference: 'fixture',
        },
        openedAt: new Date(0).toISOString(),
        providerReference: 'disabled',
        result: {
          assetReference: 'disabled',
          displayName: 'Disabled',
          insuredValue: { amount: '0', currency: 'USDC', decimals: 6 },
          poolVersion: 'disabled',
          sourceTimestamp: new Date(0).toISOString(),
          valuationPolicyHash: '0'.repeat(64),
        },
        status: 'opened',
      }),
    ).toThrow('partner API contract is confirmed');
  });
});
