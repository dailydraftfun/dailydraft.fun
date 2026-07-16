import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type DatabaseClient, DuelSide as DatabaseDuelSide } from '@openpacksduel/db';
import { PublicKey } from '@solana/web3.js';

import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DevnetDemoSignerService } from '../transactions/devnet-demo-signer.service.js';
import type {
  GeneratedPack,
  GeneratePackInput,
  OpenPackInput,
  ProviderCardResult,
  ProviderPackSnapshot,
} from './pack-provider.js';
import { PackProvider } from './pack-provider.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { PokemonTcgClient } from './pokemon-tcg.client.js';
import { DEVNET_DEMO_VALUATION_POLICY_HASH } from './valuation-policy.js';

const REFERENCE_PREFIX = 'opd1_';
const POOL_VERSION = 'openpacksduel-devnet-pokemon.v1';
const PACK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const CARD_POOL = ['base1-4', 'base1-58', 'base1-2', 'base1-15', 'base1-22'] as const;
const DEPOSIT_LEASE_MS = 120_000;
const DEPOSIT_WAIT_ATTEMPTS = 120;
const DEPOSIT_WAIT_MS = 500;

interface DemoPackReference {
  duel: PublicKey;
  packId: string;
  side: 'creator' | 'opponent';
}

@Injectable()
export class DevnetDemoPackProvider extends PackProvider {
  readonly mode = 'openpacksduel-devnet' as const;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly signer: DevnetDemoSignerService,
    private readonly pokemon: PokemonTcgClient,
  ) {
    super();
  }

  async generatePack(input: GeneratePackInput): Promise<GeneratedPack> {
    await this.signer.assertReady();
    if (!PACK_ID_PATTERN.test(input.providerPackId)) {
      throw new BadRequestException('Demo provider pack ID is invalid');
    }
    const duel = parsePublicKey(input.recipientWallet, 'recipientWallet');
    const payload = Buffer.from(
      JSON.stringify({
        d: duel.toBase58(),
        p: input.providerPackId,
        s: input.side === 'creator' ? 'c' : 'o',
        v: 1,
      }),
    ).toString('base64url');
    const mac = this.signer.referenceMac(payload).slice(0, 32);
    const providerReference = `${REFERENCE_PREFIX}${payload}.${mac}`;
    const existing = await this.database.devnetPackSnapshot.findUnique({
      where: { providerReference },
    });
    if (!existing) {
      const cardId = selectCardId(providerReference);
      const card = await this.pokemon.getCard(cardId);
      await this.database.devnetPackSnapshot.upsert({
        create: {
          displayName: card.displayName,
          duelId: input.duelId,
          imageUrl: card.imageUrl,
          insuredValueAmount: card.marketValueMicroUsdc,
          priceVariant: card.priceVariant,
          pokemonCardId: card.cardId,
          priceUpdatedAt: card.priceUpdatedAt,
          providerPackId: input.providerPackId,
          providerReference,
          side: input.side === 'creator' ? DatabaseDuelSide.CREATOR : DatabaseDuelSide.OPPONENT,
          sourceTimestamp: card.sourceTimestamp,
        },
        update: {},
        where: { providerReference },
      });
    }
    return { providerReference, status: 'generated' };
  }

  async openPack(input: OpenPackInput): Promise<ProviderPackSnapshot> {
    const reference = this.parseReference(input.providerReference);
    const snapshot = await this.requireSnapshot(input.providerReference, reference);
    const card = await this.ensureSnapshotDeposited(input.providerReference, reference, snapshot);
    return this.openedSnapshot(input.providerReference, card.mint, card.openedAt, snapshot);
  }

  async getPack(providerReference: string): Promise<ProviderPackSnapshot> {
    await this.signer.assertReady();
    const reference = this.parseReference(providerReference);
    const snapshot = await this.requireSnapshot(providerReference, reference);
    if (!snapshot.assetReference || !snapshot.openedAt) {
      const deposited = await this.signer.isCardDeposited({
        duel: reference.duel,
        providerReference,
        role: reference.side,
      });
      if (!deposited) return { providerReference, status: 'generated' };
    }
    const opened = await this.ensureSnapshotDeposited(providerReference, reference, snapshot);
    return this.openedSnapshot(providerReference, opened.mint, opened.openedAt, snapshot);
  }

  private async ensureSnapshotDeposited(
    providerReference: string,
    reference: DemoPackReference,
    initialSnapshot: Awaited<ReturnType<DevnetDemoPackProvider['requireSnapshot']>>,
  ) {
    let snapshot = initialSnapshot;
    if (snapshot.assetReference && snapshot.openedAt) {
      return this.verifyCompletedDeposit(providerReference, reference, snapshot.assetReference);
    }

    const leaseOwner = randomUUID();
    for (let attempt = 0; attempt < DEPOSIT_WAIT_ATTEMPTS; attempt += 1) {
      const now = new Date();
      const claimed = await this.database.devnetPackSnapshot.updateMany({
        data: {
          depositLeaseExpiresAt: new Date(now.getTime() + DEPOSIT_LEASE_MS),
          depositLeaseOwner: leaseOwner,
        },
        where: {
          assetReference: null,
          OR: [
            { depositLeaseOwner: null },
            { depositLeaseExpiresAt: null },
            { depositLeaseExpiresAt: { lte: now } },
          ],
          providerReference,
        },
      });
      if (claimed.count === 1) {
        try {
          const deposited = await this.signer.ensureCardDeposited({
            duel: reference.duel,
            providerReference,
            role: reference.side,
          });
          const completed = await this.database.devnetPackSnapshot.updateMany({
            data: {
              assetReference: deposited.mint.toBase58(),
              depositLeaseExpiresAt: null,
              depositLeaseOwner: null,
              depositSignature: deposited.signature,
              openedAt: deposited.openedAt,
            },
            where: { depositLeaseOwner: leaseOwner, providerReference },
          });
          if (completed.count !== 1) {
            throw new ServiceUnavailableException('Demo provider deposit lease was lost');
          }
          return deposited;
        } catch (error) {
          await this.database.devnetPackSnapshot.updateMany({
            data: { depositLeaseExpiresAt: null, depositLeaseOwner: null },
            where: { depositLeaseOwner: leaseOwner, providerReference },
          });
          throw error;
        }
      }

      if (attempt % 4 === 3) {
        const deposited = await this.signer.isCardDeposited({
          duel: reference.duel,
          providerReference,
          role: reference.side,
        });
        if (deposited) {
          const recovered = await this.signer.ensureCardDeposited({
            duel: reference.duel,
            providerReference,
            role: reference.side,
          });
          await this.database.devnetPackSnapshot.updateMany({
            data: {
              assetReference: recovered.mint.toBase58(),
              openedAt: recovered.openedAt,
            },
            where: { assetReference: null, providerReference },
          });
          return recovered;
        }
      }

      await delay(DEPOSIT_WAIT_MS);
      snapshot = await this.requireSnapshot(providerReference, reference);
      if (snapshot.assetReference && snapshot.openedAt) {
        return this.verifyCompletedDeposit(providerReference, reference, snapshot.assetReference);
      }
    }
    throw new ServiceUnavailableException('Demo provider card deposit is still in progress');
  }

  private async verifyCompletedDeposit(
    providerReference: string,
    reference: DemoPackReference,
    expectedMint: string,
  ) {
    const deposited = await this.signer.ensureCardDeposited({
      duel: reference.duel,
      providerReference,
      role: reference.side,
    });
    if (deposited.mint.toBase58() !== expectedMint) {
      throw new ServiceUnavailableException('Demo provider deposit does not match its snapshot');
    }
    return deposited;
  }

  private openedSnapshot(
    providerReference: string,
    mint: PublicKey,
    openedAt: Date,
    snapshot: {
      displayName: string;
      imageUrl: string;
      insuredValueAmount: string;
      pokemonCardId: string;
      priceUpdatedAt: string;
      priceVariant: string;
      sourceTimestamp: Date;
    },
  ): ProviderPackSnapshot {
    return {
      openedAt: openedAt.toISOString(),
      providerReference,
      result: resultFor(mint, snapshot),
      status: 'opened',
    };
  }

  private async requireSnapshot(providerReference: string, reference: DemoPackReference) {
    const snapshot = await this.database.devnetPackSnapshot.findUnique({
      where: { providerReference },
    });
    const expectedSide =
      reference.side === 'creator' ? DatabaseDuelSide.CREATOR : DatabaseDuelSide.OPPONENT;
    if (
      !snapshot ||
      snapshot.providerPackId !== reference.packId ||
      snapshot.side !== expectedSide
    ) {
      throw new ServiceUnavailableException('Demo provider valuation snapshot is unavailable');
    }
    return snapshot;
  }

  private parseReference(providerReference: string): DemoPackReference {
    if (!providerReference.startsWith(REFERENCE_PREFIX) || providerReference.length > 200) {
      throw new BadRequestException('Demo provider reference is invalid');
    }
    const [payload, suppliedMac, extra] = providerReference
      .slice(REFERENCE_PREFIX.length)
      .split('.');
    if (!payload || !suppliedMac || extra || !/^[a-f0-9]{32}$/.test(suppliedMac)) {
      throw new BadRequestException('Demo provider reference is invalid');
    }
    const expectedMac = this.signer.referenceMac(payload).slice(0, 32);
    if (!timingSafeEqual(Buffer.from(suppliedMac, 'hex'), Buffer.from(expectedMac, 'hex'))) {
      throw new BadRequestException('Demo provider reference signature is invalid');
    }
    try {
      const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!isObject(decoded) || decoded.v !== 1) throw new Error('unsupported reference');
      if (
        typeof decoded.d !== 'string' ||
        typeof decoded.p !== 'string' ||
        !PACK_ID_PATTERN.test(decoded.p) ||
        (decoded.s !== 'c' && decoded.s !== 'o')
      ) {
        throw new Error('invalid payload');
      }
      return {
        duel: parsePublicKey(decoded.d, 'duel'),
        packId: decoded.p,
        side: decoded.s === 'c' ? 'creator' : 'opponent',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Demo provider reference payload is invalid');
    }
  }
}

function resultFor(
  mint: PublicKey,
  snapshot: {
    displayName: string;
    imageUrl: string;
    insuredValueAmount: string;
    pokemonCardId: string;
    priceUpdatedAt: string;
    priceVariant: string;
    sourceTimestamp: Date;
  },
): ProviderCardResult {
  return {
    assetReference: mint.toBase58(),
    displayName: snapshot.displayName,
    imageUrl: snapshot.imageUrl,
    insuredValue: {
      amount: snapshot.insuredValueAmount,
      currency: 'USDC',
      decimals: 6,
    },
    poolVersion: POOL_VERSION,
    sourceTimestamp: snapshot.sourceTimestamp.toISOString(),
    valuationSourceReference: [
      'pokemon-tcg',
      snapshot.pokemonCardId,
      'tcgplayer',
      snapshot.priceVariant,
      'market',
      snapshot.priceUpdatedAt,
    ].join(':'),
    valuationPolicyHash: DEVNET_DEMO_VALUATION_POLICY_HASH,
  };
}

function selectCardId(providerReference: string): string {
  const digest = createHash('sha256').update(providerReference).digest();
  const cardId = CARD_POOL[digest.readUInt32BE(0) % CARD_POOL.length];
  if (!cardId) throw new ServiceUnavailableException('Demo card pool is empty');
  return cardId;
}

function parsePublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new BadRequestException(`${label} is not a valid Solana address`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
