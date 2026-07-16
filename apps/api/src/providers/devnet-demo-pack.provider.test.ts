import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '@openpacksduel/db';
import { Keypair, PublicKey } from '@solana/web3.js';

import type { DevnetDemoSignerService } from '../transactions/devnet-demo-signer.service.js';
import { DevnetDemoPackProvider } from './devnet-demo-pack.provider.js';
import type { PokemonTcgClient } from './pokemon-tcg.client.js';

const DUEL = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
const OPENED_AT = new Date('2026-07-16T01:00:00.000Z');

describe('DevnetDemoPackProvider', () => {
  test('replays a signed reference and returns a real mint after escrow deposit', async () => {
    const signer = new FixtureSigner();
    const provider = createProvider(signer);
    const input = {
      duelId: 'duel_test',
      idempotencyKey: 'duel_test:creator:generate',
      providerPackId: 'pokemon_50',
      recipientWallet: DUEL.toBase58(),
      side: 'creator' as const,
    };

    const first = await provider.generatePack(input);
    const replay = await provider.generatePack(input);
    const opened = await provider.openPack({
      idempotencyKey: 'duel_test:creator:open',
      providerReference: first.providerReference,
    });

    expect(first.providerReference).toBe(replay.providerReference);
    expect(first.providerReference.length).toBeLessThanOrEqual(200);
    expect(opened).toEqual(
      expect.objectContaining({
        openedAt: OPENED_AT.toISOString(),
        status: 'opened',
      }),
    );
    if (opened.status !== 'opened') throw new Error('Expected an opened pack');
    expect(opened.result.assetReference).toBe(MINT.toBase58());
    expect(opened.result.poolVersion).toBe('openpacksduel-devnet-pokemon.v1');
    expect(signer.deposits).toEqual([{ duel: DUEL, role: 'creator' }]);
  });

  test('rejects a tampered provider reference before touching Solana', async () => {
    const signer = new FixtureSigner();
    const provider = createProvider(signer);
    const generated = await provider.generatePack({
      duelId: 'duel_test',
      idempotencyKey: 'generate',
      providerPackId: 'pokemon_50',
      recipientWallet: DUEL.toBase58(),
      side: 'opponent',
    });
    const finalCharacter = generated.providerReference.at(-1);
    const tampered = `${generated.providerReference.slice(0, -1)}${finalCharacter === '0' ? '1' : '0'}`;

    await expect(
      provider.openPack({
        idempotencyKey: 'open',
        providerReference: tampered,
      }),
    ).rejects.toThrow('signature is invalid');
    expect(signer.deposits).toEqual([]);
  });
});

function createProvider(signer: FixtureSigner): DevnetDemoPackProvider {
  return new DevnetDemoPackProvider(
    new FixtureDatabase() as unknown as DatabaseClient,
    signer as unknown as DevnetDemoSignerService,
    new FixturePokemonClient() as unknown as PokemonTcgClient,
  );
}

class FixtureSigner {
  readonly deposits: Array<{ duel: PublicKey; role: 'creator' | 'opponent' }> = [];

  async assertReady(): Promise<void> {}

  referenceMac(payload: string): string {
    return createHash('sha256').update(`fixture:${payload}`).digest('hex');
  }

  async ensureCardDeposited(input: {
    duel: PublicKey;
    providerReference: string;
    role: 'creator' | 'opponent';
  }) {
    this.deposits.push({ duel: input.duel, role: input.role });
    return {
      mint: MINT,
      openedAt: OPENED_AT,
      signature: 'fixture-signature',
      sourceTokenAccount: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
    };
  }

  async isCardDeposited(): Promise<boolean> {
    return true;
  }

  demoMint(): PublicKey {
    return MINT;
  }
}

class FixtureDatabase {
  readonly #snapshots = new Map<string, Record<string, unknown>>();
  readonly devnetPackSnapshot = {
    findUnique: async (input: { where: { providerReference: string } }) =>
      this.#snapshots.get(input.where.providerReference) ?? null,
    upsert: async (input: { create: Record<string, unknown> }) => {
      this.#snapshots.set(String(input.create.providerReference), input.create);
      return input.create;
    },
  };
}

class FixturePokemonClient {
  async getCard(cardId: string) {
    return {
      cardId,
      displayName: 'Charizard',
      imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
      marketValueMicroUsdc: '773510000',
      priceUpdatedAt: '2026/07/15',
      sourceTimestamp: new Date('2026-07-16T00:59:59.000Z'),
    };
  }
}
