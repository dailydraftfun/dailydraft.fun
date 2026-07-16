import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@openpacksduel/db';
import { Keypair, type PublicKey } from '@solana/web3.js';

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
    expect(opened.result.valuationSourceReference).toContain(':tcgplayer:holofoil:market:');
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

  test('leases a side so concurrent opens broadcast one deposit and replay the result', async () => {
    const signer = new FixtureSigner();
    const database = new FixtureDatabase();
    const provider = createProvider(signer, database);
    const generated = await provider.generatePack({
      duelId: 'duel_concurrent',
      idempotencyKey: 'generate',
      providerPackId: 'pokemon_50',
      recipientWallet: DUEL.toBase58(),
      side: 'creator',
    });

    const [first, second] = await Promise.all([
      provider.openPack({
        idempotencyKey: 'open-1',
        providerReference: generated.providerReference,
      }),
      provider.openPack({
        idempotencyKey: 'open-2',
        providerReference: generated.providerReference,
      }),
    ]);

    expect(first).toEqual(second);
    expect(signer.deposits).toEqual([{ duel: DUEL, role: 'creator' }]);
  });
});

function createProvider(
  signer: FixtureSigner,
  database: FixtureDatabase = new FixtureDatabase(),
): DevnetDemoPackProvider {
  return new DevnetDemoPackProvider(
    database as unknown as DatabaseClient,
    signer as unknown as DevnetDemoSignerService,
    new FixturePokemonClient() as unknown as PokemonTcgClient,
  );
}

class FixtureSigner {
  readonly deposits: Array<{ duel: PublicKey; role: 'creator' | 'opponent' }> = [];
  #deposited = false;

  async assertReady(): Promise<void> {}

  referenceMac(payload: string): string {
    return createHash('sha256').update(`fixture:${payload}`).digest('hex');
  }

  async ensureCardDeposited(input: {
    duel: PublicKey;
    providerReference: string;
    role: 'creator' | 'opponent';
  }) {
    if (!this.#deposited) {
      this.deposits.push({ duel: input.duel, role: input.role });
      await new Promise((resolve) => setTimeout(resolve, 20));
      this.#deposited = true;
    }
    return {
      mint: MINT,
      openedAt: OPENED_AT,
      signature: 'fixture-signature',
      sourceTokenAccount: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
    };
  }

  async isCardDeposited(): Promise<boolean> {
    return this.#deposited;
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
      const key = String(input.create.providerReference);
      const existing = this.#snapshots.get(key);
      if (existing) return existing;
      const created = {
        assetReference: null,
        depositLeaseExpiresAt: null,
        depositLeaseOwner: null,
        depositSignature: null,
        openedAt: null,
        ...input.create,
      };
      this.#snapshots.set(key, created);
      return created;
    },
    updateMany: async (input: {
      data: Record<string, unknown>;
      where: {
        assetReference?: null;
        depositLeaseOwner?: string | null;
        OR?: Array<Record<string, unknown>>;
        providerReference: string;
      };
    }) => {
      const current = this.#snapshots.get(input.where.providerReference);
      if (!current) return { count: 0 };
      if (input.where.assetReference === null && current.assetReference !== null) {
        return { count: 0 };
      }
      if (
        typeof input.where.depositLeaseOwner === 'string' &&
        current.depositLeaseOwner !== input.where.depositLeaseOwner
      ) {
        return { count: 0 };
      }
      if (input.where.OR && !leaseIsAvailable(current, input.where.OR)) return { count: 0 };
      Object.assign(current, input.data);
      return { count: 1 };
    },
  };
}

function leaseIsAvailable(
  current: Record<string, unknown>,
  clauses: Array<Record<string, unknown>>,
): boolean {
  return clauses.some((clause) => {
    if ('depositLeaseOwner' in clause) return current.depositLeaseOwner === null;
    if ('depositLeaseExpiresAt' in clause && clause.depositLeaseExpiresAt === null) {
      return current.depositLeaseExpiresAt === null;
    }
    const expiry = clause.depositLeaseExpiresAt as { lte?: Date } | undefined;
    return (
      expiry?.lte instanceof Date &&
      current.depositLeaseExpiresAt instanceof Date &&
      current.depositLeaseExpiresAt <= expiry.lte
    );
  });
}

class FixturePokemonClient {
  async getCard(cardId: string) {
    return {
      cardId,
      displayName: 'Charizard',
      imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
      marketValueMicroUsdc: '773510000',
      priceUpdatedAt: '2026-07-15T00:00:00.000Z',
      priceVariant: 'holofoil',
      sourceTimestamp: new Date('2026-07-15T00:00:00.000Z'),
    };
  }
}
