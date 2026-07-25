import type { DatabaseClient, Prisma } from '@dailydraft/db';
import { ConflictException, Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import {
  type CreateWalletAuthChallengeRecord,
  type CreateWalletSessionRecord,
  type WalletAuthChallengeRecord,
  type WalletAuthMaintenancePolicy,
  WalletAuthRepository,
  type WalletChallengeIssuancePolicy,
  WalletChallengeRateLimitExceededError,
  type WalletSessionRecord,
} from './auth.repository.js';

const WALLET_AUTH_LOCK_NAMESPACE = 2_013_431_947;

@Injectable()
export class PrismaWalletAuthRepository extends WalletAuthRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {
    super();
  }

  async createChallenge(
    input: CreateWalletAuthChallengeRecord,
    policy: WalletChallengeIssuancePolicy,
  ): Promise<WalletAuthChallengeRecord> {
    const challenge = await this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${input.wallet}, ${WALLET_AUTH_LOCK_NAMESPACE})
        )
      `;
      await cleanupExpiredAuthRows(transaction, policy);
      const recent = await transaction.walletAuthChallenge.count({
        where: {
          createdAt: { gte: policy.challengeWindowStartedAt },
          wallet: input.wallet,
        },
      });
      if (recent >= policy.challengeLimit) return null;
      return transaction.walletAuthChallenge.create({ data: input });
    });
    if (!challenge) throw new WalletChallengeRateLimitExceededError();
    return challenge;
  }

  findChallenge(challengeId: string): Promise<WalletAuthChallengeRecord | null> {
    return this.database.walletAuthChallenge.findUnique({ where: { id: challengeId } });
  }

  async consumeChallengeAndCreateSession(
    challengeId: string,
    input: CreateWalletSessionRecord,
    policy: WalletAuthMaintenancePolicy,
  ): Promise<WalletSessionRecord> {
    const session = await this.database.$transaction(async (transaction) => {
      const consumed = await transaction.walletAuthChallenge.updateMany({
        data: { consumedAt: policy.now },
        where: {
          consumedAt: null,
          expiresAt: { gt: policy.now },
          id: challengeId,
          wallet: input.wallet,
        },
      });
      await cleanupExpiredAuthRows(transaction, policy);
      if (consumed.count !== 1) return null;
      return transaction.walletSession.create({ data: input });
    });
    if (!session) throw new ConflictException('Wallet challenge is expired or already used');
    return session;
  }

  findSession(tokenHash: string): Promise<WalletSessionRecord | null> {
    return this.database.walletSession.findUnique({ where: { tokenHash } });
  }

  async touchSession(sessionId: string, now: Date): Promise<void> {
    await this.database.walletSession.updateMany({
      data: { lastUsedAt: now },
      where: { id: sessionId, revokedAt: null },
    });
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.database.walletSession.updateMany({
      data: { revokedAt: now },
      where: { revokedAt: null, tokenHash },
    });
  }
}

async function cleanupExpiredAuthRows(
  transaction: Prisma.TransactionClient,
  policy: WalletAuthMaintenancePolicy,
): Promise<void> {
  const [challenges, sessions] = await Promise.all([
    transaction.walletAuthChallenge.findMany({
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: policy.cleanupBatchSize,
      where: {
        consumedAt: null,
        createdAt: { lt: policy.challengeCreatedBefore },
        expiresAt: { lte: policy.now },
      },
    }),
    transaction.walletSession.findMany({
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: policy.cleanupBatchSize,
      where: {
        OR: [{ expiresAt: { lte: policy.now } }, { revokedAt: { not: null } }],
      },
    }),
  ]);

  await Promise.all([
    challenges.length > 0
      ? transaction.walletAuthChallenge.deleteMany({
          where: { id: { in: challenges.map(({ id }) => id) } },
        })
      : undefined,
    sessions.length > 0
      ? transaction.walletSession.deleteMany({
          where: { id: { in: sessions.map(({ id }) => id) } },
        })
      : undefined,
  ]);
}
