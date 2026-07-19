import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import bs58 from 'bs58';

import { AuthController } from './auth.controller.js';
import {
  type CreateWalletAuthChallengeRecord,
  type CreateWalletSessionRecord,
  type WalletAuthChallengeRecord,
  WalletAuthRepository,
  type WalletSessionRecord,
} from './auth.repository.js';
import { WalletAuthService } from './wallet-auth.service.js';

const originalAppUrl = process.env.OPENPACKSDUEL_APP_URL;
const originalAuthDomain = process.env.OPENPACKSDUEL_AUTH_DOMAIN;
const originalNodeEnvironment = process.env.NODE_ENV;
const originalVercel = process.env.VERCEL;
const originalVercelEnvironment = process.env.VERCEL_ENV;

beforeEach(() => {
  delete process.env.OPENPACKSDUEL_APP_URL;
  delete process.env.OPENPACKSDUEL_AUTH_DOMAIN;
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  setEnvironment('OPENPACKSDUEL_APP_URL', originalAppUrl);
  setEnvironment('OPENPACKSDUEL_AUTH_DOMAIN', originalAuthDomain);
  setEnvironment('NODE_ENV', originalNodeEnvironment);
  setEnvironment('VERCEL', originalVercel);
  setEnvironment('VERCEL_ENV', originalVercelEnvironment);
});

describe('WalletAuthService', () => {
  test('issues a human-readable challenge bound to the devnet domain, URI, and chain', async () => {
    process.env.OPENPACKSDUEL_APP_URL = 'https://openpacksduel.vercel.app';
    const wallet = createWallet();
    const service = new WalletAuthService(new FakeWalletAuthRepository());

    const challenge = await service.issueChallenge(wallet.address);

    expect(challenge.domain).toBe('openpacksduel.vercel.app');
    expect(challenge.uri).toBe('https://openpacksduel.vercel.app');
    expect(challenge.chain).toBe('solana:devnet');
    expect(challenge.message).toContain('Chain ID: solana:devnet');
    expect(challenge.message).toContain(`Request ID: ${challenge.challengeId}`);
    expect(challenge.message).toContain(wallet.address);
  });

  test('verifies Ed25519 ownership and authenticates an opaque hashed session', async () => {
    process.env.OPENPACKSDUEL_APP_URL = 'http://localhost:3001';
    const repository = new FakeWalletAuthRepository();
    const service = new WalletAuthService(repository);
    const wallet = createWallet();
    const challenge = await service.issueChallenge(wallet.address);

    const session = await service.createSession({
      challengeId: challenge.challengeId,
      signature: signMessage(challenge.message, wallet.privateKey),
      wallet: wallet.address,
    });
    const authentication = await service.authenticate(session.token);

    expect(session.token.startsWith('opd_devnet_session_')).toBe(true);
    expect(repository.lastSessionTokenHash).not.toContain(session.token);
    expect(authentication.wallet).toBe(wallet.address);
  });

  test('consumes a challenge exactly once', async () => {
    const repository = new FakeWalletAuthRepository();
    const service = new WalletAuthService(repository);
    const wallet = createWallet();
    const challenge = await service.issueChallenge(wallet.address);
    const input = {
      challengeId: challenge.challengeId,
      signature: signMessage(challenge.message, wallet.privateKey),
      wallet: wallet.address,
    };

    await service.createSession(input);

    await expect(service.createSession(input)).rejects.toThrow('expired or already used');
  });

  test('keeps concurrent challenges independently usable for the same wallet', async () => {
    const repository = new FakeWalletAuthRepository();
    const service = new WalletAuthService(repository);
    const wallet = createWallet();
    const first = await service.issueChallenge(wallet.address);
    const second = await service.issueChallenge(wallet.address);

    const firstSession = await service.createSession({
      challengeId: first.challengeId,
      signature: signMessage(first.message, wallet.privateKey),
      wallet: wallet.address,
    });
    const secondSession = await service.createSession({
      challengeId: second.challengeId,
      signature: signMessage(second.message, wallet.privateKey),
      wallet: wallet.address,
    });

    expect(firstSession.token).not.toBe(secondSession.token);
  });

  test('rejects a regex-shaped address that does not decode to 32 bytes before persistence', async () => {
    const repository = new FakeWalletAuthRepository();
    const service = new WalletAuthService(repository);

    await expect(service.issueChallenge('111111111111111111111111111111111')).rejects.toThrow(
      '32-byte Solana public key',
    );
    expect(repository.challengeCount).toBe(0);
  });

  test('rejects a signature from a different wallet without consuming the challenge', async () => {
    const repository = new FakeWalletAuthRepository();
    const service = new WalletAuthService(repository);
    const wallet = createWallet();
    const attacker = createWallet();
    const challenge = await service.issueChallenge(wallet.address);

    await expect(
      service.createSession({
        challengeId: challenge.challengeId,
        signature: signMessage(challenge.message, attacker.privateKey),
        wallet: wallet.address,
      }),
    ).rejects.toThrow('signature is invalid');

    const session = await service.createSession({
      challengeId: challenge.challengeId,
      signature: signMessage(challenge.message, wallet.privateKey),
      wallet: wallet.address,
    });
    expect(session.wallet).toBe(wallet.address);
  });

  test('returns a stable service-unavailable error when deployed audience config is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OPENPACKSDUEL_APP_URL;
    delete process.env.OPENPACKSDUEL_AUTH_DOMAIN;
    const repository = new FakeWalletAuthRepository();
    const controller = new AuthController(new WalletAuthService(repository));

    const error = await captureFailure(
      controller.createChallenge({ wallet: createWallet().address }),
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toMatchObject({
      error: 'Service Unavailable',
      message: 'OPENPACKSDUEL_APP_URL is not configured',
      statusCode: 503,
    });
    expect(repository.challengeCount).toBe(0);
  });

  test('refuses to create a session after deployed audience config becomes unavailable', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OPENPACKSDUEL_APP_URL = 'https://openpacksduel.vercel.app';
    const repository = new FakeWalletAuthRepository();
    const service = new WalletAuthService(repository);
    const wallet = createWallet();
    const challenge = await service.issueChallenge(wallet.address);
    delete process.env.OPENPACKSDUEL_APP_URL;

    const error = await captureFailure(
      service.createSession({
        challengeId: challenge.challengeId,
        signature: signMessage(challenge.message, wallet.privateKey),
        wallet: wallet.address,
      }),
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
  });

  test('rejects an auth domain that disagrees with the configured public app host', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OPENPACKSDUEL_APP_URL = 'https://openpacksduel.vercel.app';
    process.env.OPENPACKSDUEL_AUTH_DOMAIN = 'example.com';
    const service = new WalletAuthService(new FakeWalletAuthRepository());

    const error = await captureFailure(service.issueChallenge(createWallet().address));

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as Error).message).toContain('must match');
  });
});

class FakeWalletAuthRepository extends WalletAuthRepository {
  readonly #challenges = new Map<string, WalletAuthChallengeRecord>();
  readonly #sessions = new Map<string, WalletSessionRecord>();
  lastSessionTokenHash = '';

  get challengeCount(): number {
    return this.#challenges.size;
  }

  async createChallenge(
    input: CreateWalletAuthChallengeRecord,
  ): Promise<WalletAuthChallengeRecord> {
    this.#challenges.set(input.id, input);
    return input;
  }

  async findChallenge(challengeId: string): Promise<WalletAuthChallengeRecord | null> {
    return this.#challenges.get(challengeId) ?? null;
  }

  async consumeChallengeAndCreateSession(
    challengeId: string,
    input: CreateWalletSessionRecord,
    now: Date,
  ): Promise<WalletSessionRecord> {
    const challenge = this.#challenges.get(challengeId);
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
      throw new Error('Wallet challenge is expired or already used');
    }
    this.#challenges.set(challengeId, { ...challenge, consumedAt: now });
    const session = { ...input, revokedAt: null };
    this.#sessions.set(input.tokenHash, session);
    this.lastSessionTokenHash = input.tokenHash;
    return session;
  }

  async findSession(tokenHash: string): Promise<WalletSessionRecord | null> {
    return this.#sessions.get(tokenHash) ?? null;
  }

  async touchSession(_sessionId: string, _now: Date): Promise<void> {}

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    const session = this.#sessions.get(tokenHash);
    if (session) this.#sessions.set(tokenHash, { ...session, revokedAt: now });
  }
}

function createWallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  return { address: bs58.encode(publicKeyDer.subarray(-32)), privateKey };
}

function signMessage(message: string, privateKey: ReturnType<typeof createWallet>['privateKey']) {
  return sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64');
}

async function captureFailure(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
    throw new Error('Expected action to fail');
  } catch (error) {
    return error;
  }
}

function setEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
