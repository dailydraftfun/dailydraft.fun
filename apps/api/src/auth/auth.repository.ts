export interface WalletAuthChallengeRecord {
  consumedAt: Date | null;
  expiresAt: Date;
  id: string;
  message: string;
  wallet: string;
}

export interface WalletSessionRecord {
  expiresAt: Date;
  id: string;
  revokedAt: Date | null;
  wallet: string;
}

export interface CreateWalletAuthChallengeRecord extends WalletAuthChallengeRecord {
  chain: string;
  domain: string;
  nonceHash: string;
  uri: string;
}

export interface CreateWalletSessionRecord {
  expiresAt: Date;
  id: string;
  tokenHash: string;
  wallet: string;
}

export interface WalletAuthMaintenancePolicy {
  challengeCreatedBefore: Date;
  cleanupBatchSize: number;
  now: Date;
}

export interface WalletChallengeIssuancePolicy extends WalletAuthMaintenancePolicy {
  challengeLimit: number;
  challengeWindowStartedAt: Date;
}

export class WalletChallengeRateLimitExceededError extends Error {
  constructor() {
    super('Wallet challenge issuance rate limit exceeded');
    this.name = 'WalletChallengeRateLimitExceededError';
  }
}

export abstract class WalletAuthRepository {
  abstract createChallenge(
    input: CreateWalletAuthChallengeRecord,
    policy: WalletChallengeIssuancePolicy,
  ): Promise<WalletAuthChallengeRecord>;

  abstract findChallenge(challengeId: string): Promise<WalletAuthChallengeRecord | null>;

  abstract consumeChallengeAndCreateSession(
    challengeId: string,
    input: CreateWalletSessionRecord,
    policy: WalletAuthMaintenancePolicy,
  ): Promise<WalletSessionRecord>;

  abstract findSession(tokenHash: string): Promise<WalletSessionRecord | null>;

  abstract touchSession(sessionId: string, now: Date): Promise<void>;

  abstract revokeSession(tokenHash: string, now: Date): Promise<void>;
}
