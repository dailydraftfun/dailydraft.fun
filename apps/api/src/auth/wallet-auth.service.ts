import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import bs58 from 'bs58';
import type { CreateWalletSessionRequest } from './auth.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract repository as a runtime injection token.
import {
  type WalletAuthMaintenancePolicy,
  WalletAuthRepository,
  WalletChallengeRateLimitExceededError,
} from './auth.repository.js';

const AUTH_CHAIN = 'solana:devnet';
const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 15 * 60 * 1_000;
const SESSION_TOKEN_PREFIX = 'opd_devnet_session_';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DEFAULT_CHALLENGE_LIMIT = 5;
const DEFAULT_CHALLENGE_WINDOW_SECONDS = 10 * 60;
const DEFAULT_CLEANUP_BATCH_SIZE = 100;
const MAX_CHALLENGE_LIMIT = 100;
const MAX_CHALLENGE_WINDOW_SECONDS = 24 * 60 * 60;
const MAX_CLEANUP_BATCH_SIZE = 500;

export interface WalletAuthentication {
  kind: 'wallet-session';
  sessionId: string;
  wallet: string;
}

@Injectable()
export class WalletAuthService {
  constructor(private readonly repository: WalletAuthRepository) {}

  async issueChallenge(wallet: string): Promise<{
    chain: typeof AUTH_CHAIN;
    challengeId: string;
    domain: string;
    expiresAt: string;
    message: string;
    uri: string;
    wallet: string;
  }> {
    requireValidWalletPublicKey(wallet);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const challengeId = `authc_${crypto.randomUUID().replaceAll('-', '')}`;
    const nonce = randomBytes(24).toString('base64url');
    const { domain, uri } = resolveAudience();
    const message = createWalletSignInMessage({
      challengeId,
      domain,
      expiresAt,
      issuedAt: now,
      nonce,
      uri,
      wallet,
    });

    try {
      await this.repository.createChallenge(
        {
          chain: AUTH_CHAIN,
          consumedAt: null,
          domain,
          expiresAt,
          id: challengeId,
          message,
          nonceHash: hashSecret(nonce),
          uri,
          wallet,
        },
        createRepositoryPolicy(now),
      );
    } catch (error) {
      if (error instanceof WalletChallengeRateLimitExceededError) {
        throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    }

    return {
      chain: AUTH_CHAIN,
      challengeId,
      domain,
      expiresAt: expiresAt.toISOString(),
      message,
      uri,
      wallet,
    };
  }

  async createSession(input: CreateWalletSessionRequest): Promise<{
    expiresAt: string;
    network: 'solana-devnet';
    token: string;
    wallet: string;
  }> {
    const challenge = await this.repository.findChallenge(input.challengeId);
    const now = new Date();
    if (!challenge || challenge.wallet !== input.wallet) {
      throw new UnauthorizedException('Wallet challenge is invalid');
    }
    if (challenge.consumedAt || challenge.expiresAt <= now) {
      throw new ConflictException('Wallet challenge is expired or already used');
    }
    if (!verifyWalletSignature(input.wallet, challenge.message, input.signature)) {
      throw new UnauthorizedException('Wallet signature is invalid');
    }

    const token = `${SESSION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.repository.consumeChallengeAndCreateSession(
      challenge.id,
      {
        expiresAt,
        id: `auths_${crypto.randomUUID().replaceAll('-', '')}`,
        tokenHash: hashSecret(token),
        wallet: challenge.wallet,
      },
      createRepositoryPolicy(now),
    );

    return {
      expiresAt: expiresAt.toISOString(),
      network: 'solana-devnet',
      token,
      wallet: input.wallet,
    };
  }

  async authenticate(token: string | undefined): Promise<WalletAuthentication> {
    if (!token?.startsWith(SESSION_TOKEN_PREFIX)) {
      throw new UnauthorizedException('Missing or invalid wallet session');
    }
    const session = await this.repository.findSession(hashSecret(token));
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException('Wallet session is expired or invalid');
    }
    await this.repository.touchSession(session.id, now);
    return { kind: 'wallet-session', sessionId: session.id, wallet: session.wallet };
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token?.startsWith(SESSION_TOKEN_PREFIX)) return;
    await this.repository.revokeSession(hashSecret(token), new Date());
  }
}

export function createWalletSignInMessage(input: {
  challengeId: string;
  domain: string;
  expiresAt: Date;
  issuedAt: Date;
  nonce: string;
  uri: string;
  wallet: string;
}): string {
  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.wallet,
    '',
    'Authenticate to create, join, or cancel OpenPacks Duel sessions on Solana devnet.',
    '',
    `URI: ${input.uri}`,
    'Version: 1',
    `Chain ID: ${AUTH_CHAIN}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
    `Request ID: ${input.challengeId}`,
  ].join('\n');
}

export function verifyWalletSignature(wallet: string, message: string, signature: string): boolean {
  try {
    const publicKeyBytes = decodeWalletPublicKey(wallet);
    const signatureBytes = Buffer.from(signature, 'base64');
    if (!publicKeyBytes || signatureBytes.length !== 64) return false;
    const publicKey = createPublicKey({
      format: 'der',
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
      type: 'spki',
    });
    return verify(null, Buffer.from(message, 'utf8'), publicKey, signatureBytes);
  } catch {
    return false;
  }
}

function requireValidWalletPublicKey(wallet: string): void {
  if (!decodeWalletPublicKey(wallet)) {
    throw new BadRequestException('wallet must decode to a 32-byte Solana public key');
  }
}

function decodeWalletPublicKey(wallet: string): Uint8Array | null {
  try {
    const decoded = bs58.decode(wallet);
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface WalletAuthPolicy {
  challengeLimit: number;
  challengeWindowMs: number;
  cleanupBatchSize: number;
}

export function resolveWalletAuthPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): WalletAuthPolicy {
  return {
    challengeLimit: readBoundedPositiveInteger(
      environment.OPENPACKSDUEL_AUTH_CHALLENGE_LIMIT,
      DEFAULT_CHALLENGE_LIMIT,
      MAX_CHALLENGE_LIMIT,
    ),
    challengeWindowMs:
      readBoundedPositiveInteger(
        environment.OPENPACKSDUEL_AUTH_CHALLENGE_WINDOW_SECONDS,
        DEFAULT_CHALLENGE_WINDOW_SECONDS,
        MAX_CHALLENGE_WINDOW_SECONDS,
      ) * 1_000,
    cleanupBatchSize: readBoundedPositiveInteger(
      environment.OPENPACKSDUEL_AUTH_CLEANUP_BATCH_SIZE,
      DEFAULT_CLEANUP_BATCH_SIZE,
      MAX_CLEANUP_BATCH_SIZE,
    ),
  };
}

function createRepositoryPolicy(now: Date): WalletAuthMaintenancePolicy & {
  challengeLimit: number;
  challengeWindowStartedAt: Date;
} {
  const policy = resolveWalletAuthPolicy();
  const challengeWindowStartedAt = new Date(now.getTime() - policy.challengeWindowMs);
  return {
    challengeCreatedBefore: challengeWindowStartedAt,
    challengeLimit: policy.challengeLimit,
    challengeWindowStartedAt,
    cleanupBatchSize: policy.cleanupBatchSize,
    now,
  };
}

function readBoundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const normalized = value?.trim();
  if (!normalized || !/^[0-9]+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

function resolveAudience(): { domain: string; uri: string } {
  const configuredUri = process.env.OPENPACKSDUEL_APP_URL ?? 'http://localhost:3001';
  let appUrl: URL;
  try {
    appUrl = new URL(configuredUri);
  } catch {
    throw new BadRequestException('OPENPACKSDUEL_APP_URL must be an absolute URL');
  }
  if (appUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(appUrl.hostname)) {
    throw new BadRequestException('Wallet authentication requires HTTPS outside local development');
  }
  const configuredDomain = process.env.OPENPACKSDUEL_AUTH_DOMAIN?.trim();
  if (configuredDomain && configuredDomain !== appUrl.host) {
    throw new BadRequestException('OPENPACKSDUEL_AUTH_DOMAIN must match OPENPACKSDUEL_APP_URL');
  }
  return { domain: configuredDomain ?? appUrl.host, uri: appUrl.origin };
}
