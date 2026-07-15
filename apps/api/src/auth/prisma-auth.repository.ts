import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@openpacksduel/db';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import {
  type CreateWalletAuthChallengeRecord,
  type CreateWalletSessionRecord,
  type WalletAuthChallengeRecord,
  WalletAuthRepository,
  type WalletSessionRecord,
} from './auth.repository.js';

@Injectable()
export class PrismaWalletAuthRepository extends WalletAuthRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {
    super();
  }

  async createChallenge(
    input: CreateWalletAuthChallengeRecord,
  ): Promise<WalletAuthChallengeRecord> {
    return this.database.walletAuthChallenge.create({ data: input });
  }

  findChallenge(challengeId: string): Promise<WalletAuthChallengeRecord | null> {
    return this.database.walletAuthChallenge.findUnique({ where: { id: challengeId } });
  }

  async consumeChallengeAndCreateSession(
    challengeId: string,
    input: CreateWalletSessionRecord,
    now: Date,
  ): Promise<WalletSessionRecord> {
    return this.database.$transaction(async (transaction) => {
      const consumed = await transaction.walletAuthChallenge.updateMany({
        data: { consumedAt: now },
        where: {
          consumedAt: null,
          expiresAt: { gt: now },
          id: challengeId,
          wallet: input.wallet,
        },
      });
      if (consumed.count !== 1) {
        throw new ConflictException('Wallet challenge is expired or already used');
      }
      return transaction.walletSession.create({ data: input });
    });
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
