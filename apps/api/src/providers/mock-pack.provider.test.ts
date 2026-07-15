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

    expect(replay.providerReference).toBe(first.providerReference);
    expect(opened.status).toBe('opened');
    expect(await provider.getPack(first.providerReference)).toEqual(opened);
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
  });
});
