import type { JourneyFixtureBootstrap } from '../../app/e2e/journey-wallet';
import type {
  DuelReconciliationResult,
  DuelTransactionIntent,
  DurableDuel,
  MatchmakingSession,
  ProductCapabilities,
} from '../../app/solana/duel-client';

export const journeyApiOrigin = 'http://127.0.0.1:3001/__journey/v1';
export const journeyRpcUrl = 'http://127.0.0.1:3001/__journey/rpc';

type FixtureRequest = {
  authorization?: string;
  body?: unknown;
  method: string;
  path: string;
};

export type FixtureResponse = {
  body: unknown;
  status: number;
};

export type JourneyFixtureSnapshot = {
  authenticated: boolean;
  duel: DurableDuel | null;
  requests: string[];
  seed: string;
};

type JourneyFixtureOptions = {
  walletTransactionRejections?: number;
};

type ReloadCheckpoint = 'opening' | 'settling';

const CREATOR_WALLET = '11111111111111111111111111111111';
export const journeyOpponentWallet = 'So11111111111111111111111111111111111111112';
const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export class DuelJourneyFixture {
  readonly seed: string;
  readonly #challengeId: string;
  readonly #duelId: string;
  readonly #resultHash: string;
  readonly #sessionToken: string;
  readonly #transactionSignature: string;
  readonly #walletTransactionRejections: number;
  #authenticated = false;
  #duel: DurableDuel | null = null;
  #fundingState: 'none' | 'submitted' | 'finalized' = 'none';
  #intentSequence = 0;
  #lifecycleHold: ReloadCheckpoint | null = null;
  #matchmakingState: MatchmakingSession['state'] = 'matched';
  #reconciliationFailures = 0;
  #requests: string[] = [];
  #submittedIntentIds = new Set<string>();

  constructor(seed: string, options: JourneyFixtureOptions = {}) {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(seed)) {
      throw new Error('Journey fixture seed must use 1-32 lowercase letters, numbers, or hyphens.');
    }
    this.seed = seed;
    this.#challengeId = `authc_${stableHex(seed, 'challenge', 32)}`;
    this.#duelId = `duel_fixture_${stableHex(seed, 'duel', 16)}`;
    this.#resultHash = stableHex(seed, 'result', 64);
    this.#sessionToken = `fixture_session_${stableHex(seed, 'session', 24)}`;
    this.#transactionSignature = stableHex(seed, 'transaction', 64);
    this.#walletTransactionRejections = options.walletTransactionRejections ?? 0;
    assertCount(this.#walletTransactionRejections, 'wallet transaction rejection');
  }

  bootstrap(): JourneyFixtureBootstrap {
    return {
      failures: {
        walletTransactionRejections: this.#walletTransactionRejections,
      },
      seed: this.seed,
      transactionSignature: stableBytes(this.seed, 'transaction-signature', 64),
      version: 1,
      wallet: {
        address: CREATOR_WALLET,
        messageSignature: stableBytes(this.seed, 'message-signature', 64),
        publicKey: Array.from({ length: 32 }, () => 0),
      },
    };
  }

  reset(): void {
    this.#authenticated = false;
    this.#duel = null;
    this.#fundingState = 'none';
    this.#intentSequence = 0;
    this.#lifecycleHold = null;
    this.#matchmakingState = 'matched';
    this.#reconciliationFailures = 0;
    this.#requests = [];
    this.#submittedIntentIds.clear();
  }

  failNextReconciliations(count = 1): void {
    assertCount(count, 'reconciliation failure');
    this.#reconciliationFailures = count;
  }

  holdLifecycleAt(checkpoint: ReloadCheckpoint): void {
    this.#lifecycleHold = checkpoint;
  }

  holdMatchmaking(): void {
    this.#matchmakingState = 'searching';
  }

  completeMatchmaking(): void {
    if (!this.#duel || this.#duel.matchmakingMode !== 'open') {
      throw new Error('Journey fixture matchmaking can only complete an active public search.');
    }
    this.#matchmakingState = 'matched';
    this.#duel = {
      ...this.#duel,
      opponentWallet: journeyOpponentWallet,
      status: 'matched',
      version: this.#duel.version + 1,
    };
  }

  releaseLifecycle(): void {
    if (!this.#duel || !['opening', 'settling'].includes(this.#duel.status)) {
      throw new Error('Journey fixture lifecycle can only be released from opening or settling.');
    }
    this.#duel =
      this.#duel.status === 'opening'
        ? this.#settledDuel(this.#duel)
        : {
            ...this.#duel,
            status: 'settled',
            version: this.#duel.version + 1,
            winnerWallet: CREATOR_WALLET,
          };
    this.#lifecycleHold = null;
  }

  snapshot(): JourneyFixtureSnapshot {
    return clone({
      authenticated: this.#authenticated,
      duel: this.#duel,
      requests: this.#requests,
      seed: this.seed,
    });
  }

  handleRpc(body: unknown): FixtureResponse {
    const request = asRecord(body, 'RPC request');
    const method = requireString(request.method, 'RPC request method');
    this.#requests.push(`RPC ${method}`);

    if (method === 'getGenesisHash') {
      return ok({ id: request.id ?? null, jsonrpc: '2.0', result: DEVNET_GENESIS_HASH });
    }
    if (method === 'sendTransaction') {
      return ok({
        id: request.id ?? null,
        jsonrpc: '2.0',
        result: this.#transactionSignature,
      });
    }
    if (method === 'getSignatureStatuses') {
      return ok({
        id: request.id ?? null,
        jsonrpc: '2.0',
        result: {
          context: { slot: 321 },
          value: [
            {
              confirmationStatus: 'finalized',
              confirmations: null,
              err: null,
              slot: 320,
            },
          ],
        },
      });
    }
    return {
      body: {
        error: {
          code: -32601,
          message: `Journey RPC fixture does not implement ${method}.`,
        },
        id: request.id ?? null,
        jsonrpc: '2.0',
      },
      status: 501,
    };
  }

  handleApi(request: FixtureRequest): FixtureResponse {
    const method = request.method.toUpperCase();
    const path = normalizePath(request.path);
    this.#requests.push(`${method} ${path}`);

    if (method === 'GET' && path === '/health/capabilities') {
      return ok(capabilities());
    }
    if (method === 'POST' && path === '/analytics/events') {
      return { body: { accepted: true }, status: 202 };
    }
    if (method === 'POST' && path === '/auth/challenges') {
      const body = asRecord(request.body, 'wallet challenge');
      const wallet = requireString(body.wallet, 'wallet challenge wallet');
      if (wallet !== CREATOR_WALLET) return problem(422, 'Fixture wallet does not match the seed.');
      return ok({
        chain: 'solana:devnet',
        challengeId: this.#challengeId,
        domain: 'fixture.dailydraft.test',
        expiresAt: '2099-01-01T00:15:00.000Z',
        message: [
          'fixture.dailydraft.test wants you to sign in with your Solana account:',
          CREATOR_WALLET,
          '',
          `Journey seed: ${this.seed}`,
          `Request ID: ${this.#challengeId}`,
          'Chain ID: solana:devnet',
        ].join('\n'),
        uri: 'https://fixture.dailydraft.test',
        wallet,
      });
    }
    if (method === 'POST' && path === '/auth/sessions') {
      const body = asRecord(request.body, 'wallet session');
      if (
        body.challengeId !== this.#challengeId ||
        body.wallet !== CREATOR_WALLET ||
        typeof body.signature !== 'string' ||
        body.signature.length === 0
      ) {
        return problem(422, 'Fixture wallet session does not match the issued challenge.');
      }
      this.#authenticated = true;
      return ok({
        expiresAt: '2099-01-01T01:00:00.000Z',
        network: 'solana-devnet',
        token: this.#sessionToken,
        wallet: CREATOR_WALLET,
      });
    }
    if (method === 'POST' && path === '/auth/session/revoke') {
      this.#authenticated = false;
      return { body: null, status: 204 };
    }
    if (method === 'POST' && path === '/matchmaking/status') {
      if (!this.#duel) return problem(404, 'No fixture matchmaking session is active.');
      const authorizationError = this.#requireAuthorization(request.authorization);
      return authorizationError ?? ok(this.#matchmakingSession());
    }

    const duelPath = path.match(/^\/duels\/([^/]+)(.*)$/);
    if (duelPath && method === 'GET' && duelPath[2] === '') {
      return duelPath[1] === this.#duelId && this.#duel
        ? ok(this.#duel)
        : problem(404, 'Fixture duel is unavailable. Create or reset the seeded duel first.');
    }

    const authorizationError = this.#requireAuthorization(request.authorization);
    if (authorizationError) return authorizationError;

    if (method === 'POST' && path === '/duels') {
      const body = asRecord(request.body, 'duel creation');
      const creatorWallet = requireString(body.creatorWallet, 'duel creator wallet');
      if (creatorWallet !== CREATOR_WALLET) {
        return problem(422, 'Fixture duel creator does not match the connected wallet.');
      }
      this.#fundingState = 'none';
      this.#duel = this.#matchedDuel(
        body.matchmakingMode === 'house'
          ? 'house'
          : requireString(body.opponentWallet, 'direct duel opponent'),
      );
      return ok(this.#duel);
    }
    if (method === 'POST' && path === '/matchmaking/search') {
      this.#fundingState = 'none';
      this.#duel = this.#matchedDuel(journeyOpponentWallet, 'open');
      if (this.#matchmakingState === 'searching') {
        this.#duel = {
          ...this.#duel,
          opponentWallet: null,
          status: 'waiting',
        };
      }
      return ok(this.#matchmakingSession());
    }
    if (method === 'POST' && path === '/matchmaking/continue') {
      if (!this.#duel) return problem(409, 'Fixture matchmaking was not started.');
      return ok(this.#matchmakingSession());
    }
    if (method === 'POST' && path === '/matchmaking/cancel') {
      const duelId = this.#duel?.id ?? this.#duelId;
      this.#duel = null;
      return ok({ cancelled: true, duelId, reason: 'fixture_cancelled' });
    }

    if (duelPath) {
      const [, duelId, suffix] = duelPath;
      if (duelId !== this.#duelId || !this.#duel) {
        return problem(404, 'Fixture duel is unavailable. Create or reset the seeded duel first.');
      }
      if (method === 'GET' && suffix === '') return ok(this.#duel);
      if (method === 'POST' && suffix === '/transactions') {
        return ok(this.#transactionIntent());
      }
      if (method === 'POST' && suffix?.match(/^\/transactions\/[^/]+\/submissions$/)) {
        const intentId = suffix.split('/')[2];
        if (!intentId) return problem(422, 'Fixture funding submission intent is missing.');
        if (this.#submittedIntentIds.has(intentId)) return ok({ accepted: true, duplicate: true });
        this.#submittedIntentIds.add(intentId);
        this.#fundingState = 'submitted';
        this.#duel = { ...this.#duel, status: 'committing', version: this.#duel.version + 1 };
        return ok({ accepted: true });
      }
      if (method === 'POST' && suffix?.match(/^\/transactions\/[^/]+\/rejections$/)) {
        this.#fundingState = 'none';
        return ok({ accepted: true });
      }
      if (method === 'POST' && suffix === '/transactions/reconciliation') {
        if (this.#reconciliationFailures > 0) {
          this.#reconciliationFailures -= 1;
          return problem(503, 'Fixture RPC confirmation is temporarily unavailable.');
        }
        if (this.#fundingState === 'submitted') {
          this.#duel = { ...this.#duel, status: 'funded', version: this.#duel.version + 1 };
          this.#fundingState = 'finalized';
        }
        return ok(this.#reconciliation());
      }
      if (method === 'POST' && suffix === '/open-packs') {
        if (['opening', 'settling', 'settled'].includes(this.#duel.status)) return ok(this.#duel);
        this.#duel =
          this.#lifecycleHold === 'opening'
            ? this.#openingDuel(this.#duel)
            : this.#lifecycleHold === 'settling'
              ? this.#settlingDuel(this.#duel)
              : this.#settledDuel(this.#duel);
        return ok(this.#duel);
      }
      if (method === 'POST' && suffix === '/cancel') {
        this.#duel = { ...this.#duel, status: 'cancelled', version: this.#duel.version + 1 };
        return ok(this.#duel);
      }
    }

    return problem(501, `Journey API fixture does not implement ${method} ${path}.`);
  }

  #requireAuthorization(authorization?: string): FixtureResponse | null {
    if (!this.#authenticated || authorization !== `Bearer ${this.#sessionToken}`) {
      return problem(401, 'Journey fixture requires its seeded wallet session.');
    }
    return null;
  }

  #matchedDuel(opponent: string, mode: DurableDuel['matchmakingMode'] = 'direct'): DurableDuel {
    return {
      createdAt: '2099-01-01T00:00:00.000Z',
      creatorWallet: CREATOR_WALLET,
      environment: 'solana-devnet',
      escrowAddress: 'SysvarRent111111111111111111111111111111111',
      expiresAt: '2099-01-01T00:15:00.000Z',
      houseOpponent: opponent === 'house',
      id: this.#duelId,
      matchmakingMode: opponent === 'house' ? 'house' : mode,
      opponentWallet: opponent === 'house' ? journeyOpponentWallet : opponent,
      pack: {
        id: 'pokemon_50',
        imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
        name: 'Pokemon $50',
        price: { amount: '50000000', currency: 'USDC', decimals: 6 },
        provider: 'journey-fixture',
        providerPackId: `fixture-pack-${this.seed}`,
      },
      providerMode: 'dailydraft-devnet',
      result: null,
      stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
      status: 'matched',
      transactionSignature: null,
      version: 1,
      winnerWallet: null,
    };
  }

  #settledDuel(duel: DurableDuel): DurableDuel {
    return {
      ...duel,
      result: {
        comparisonMetric: 'insured-value',
        outcomes: [
          {
            assetReference: `fixture-asset-creator-${this.seed}`,
            displayName: 'Charizard fixture pull',
            insuredValue: { amount: '72500000', currency: 'USDC', decimals: 6 },
            isMock: false,
            provider: 'journey-fixture',
            providerReference: `fixture-provider-creator-${this.seed}`,
            side: 'creator',
          },
          {
            assetReference: `fixture-asset-opponent-${this.seed}`,
            displayName: 'Blastoise fixture pull',
            insuredValue: { amount: '41000000', currency: 'USDC', decimals: 6 },
            isMock: false,
            provider: 'journey-fixture',
            providerReference: `fixture-provider-opponent-${this.seed}`,
            side: 'opponent',
          },
        ],
        resultHash: this.#resultHash,
        settlementReady: true,
        valuationPolicyHash: stableHex(this.seed, 'valuation-policy', 64),
        winnerSide: 'creator',
      },
      status: 'settled',
      transactionSignature: this.#transactionSignature,
      version: duel.version + 1,
      winnerWallet: CREATOR_WALLET,
    };
  }

  #openingDuel(duel: DurableDuel): DurableDuel {
    return {
      ...duel,
      result: null,
      status: 'opening',
      transactionSignature: this.#transactionSignature,
      version: duel.version + 1,
      winnerWallet: null,
    };
  }

  #settlingDuel(duel: DurableDuel): DurableDuel {
    return {
      ...this.#settledDuel(duel),
      status: 'settling',
      winnerWallet: null,
    };
  }

  #transactionIntent(): DuelTransactionIntent {
    this.#intentSequence += 1;
    return {
      action: 'fund',
      chain: 'solana:devnet',
      cluster: 'devnet',
      duelId: this.#duelId,
      escrowAddress: 'SysvarRent111111111111111111111111111111111',
      expiresAt: '2099-01-01T00:10:00.000Z',
      feeAmountLamports: '10000000',
      feeAmountSol: '0.01',
      feeRecipient: journeyOpponentWallet,
      fundingSide: 'creator',
      id: `intent_${stableHex(this.seed, `intent-${this.#intentSequence}`, 20)}`,
      lastValidBlockHeight: '987654321',
      paymentMint: 'So11111111111111111111111111111111111111112',
      programId: '11111111111111111111111111111111',
      recentBlockhash: stableHex(this.seed, 'blockhash', 32),
      serializedTransactionBase64: 'AQIDBA==',
      status: 'prepared',
      wallet: CREATOR_WALLET,
      warnings: ['Fixture transaction: no live provider, RPC, or asset movement.'],
    };
  }

  #reconciliation(): DuelReconciliationResult {
    const finalized = this.#fundingState === 'finalized';
    return {
      activeTransactionCount: 0,
      duelId: this.#duelId,
      duelStatus: this.#duel?.status ?? 'matched',
      reconciliation: {
        checked: finalized ? 1 : 0,
        confirmed: 0,
        expired: 0,
        failed: 0,
        finalized: finalized ? 1 : 0,
        pending: 0,
        stuck: 0,
      },
      unboundTransactionCount: 0,
    };
  }

  #matchmakingSession(): MatchmakingSession {
    return {
      availableActions:
        this.#matchmakingState === 'searching'
          ? [
              { action: 'continue_search', available: true },
              { action: 'cancel_search', available: true },
            ]
          : [{ action: 'cancel_search', available: true }],
      cancellationRule: 'Fixture searches can be reset without value movement.',
      commitmentExpiresAt: '2099-01-01T00:15:00.000Z',
      duelId: this.#duelId,
      houseOpponent: false,
      opponentWallet: this.#matchmakingState === 'searching' ? null : journeyOpponentWallet,
      queue: {
        packId: 'pokemon_50',
        providerMode: 'dailydraft-devnet',
        queueKey: `fixture-${this.seed}`,
        regionSegment: 'fixture',
        riskSegment: 'devnet',
        tier: 50,
        valuationPolicyHash: stableHex(this.seed, 'valuation-policy', 64),
      },
      role: 'creator',
      searchExpiresAt: '2099-01-01T00:15:00.000Z',
      state: this.#matchmakingState,
      wallet: CREATOR_WALLET,
    };
  }
}

function capabilities(): ProductCapabilities {
  return {
    modes: {
      direct: { enabled: true, reason: null },
      house: { enabled: false, reason: 'House mode is disabled in deterministic journeys.' },
      open: { enabled: true, reason: null },
    },
    network: 'solana-devnet',
    packs: [
      {
        enabled: false,
        id: 'pokemon_25',
        name: 'Pokémon $25 Pack',
        reason: 'The $25 pack tier is coming soon.',
        tier: 25,
      },
      {
        enabled: true,
        id: 'pokemon_50',
        name: 'Pokémon $50 Pack',
        reason: null,
        tier: 50,
      },
      {
        enabled: false,
        id: 'pokemon_100',
        name: 'Pokémon $100 Pack',
        reason: 'The $100 pack tier is coming soon.',
        tier: 100,
      },
    ],
    provider: { mode: 'journey-fixture', ready: true },
  };
}

function ok(body: unknown): FixtureResponse {
  return { body: clone(body), status: 200 };
}

function problem(status: number, detail: string): FixtureResponse {
  return {
    body: {
      detail,
      status,
      title: 'Journey fixture request failed',
      type: 'https://fixture.dailydraft.test/problems/journey-fixture',
    },
    status,
  };
}

function normalizePath(path: string): string {
  const normalized = path
    .split('?')[0]
    ?.replace(/^\/__journey\/v1/, '')
    .replace(/^\/v1/, '');
  return normalized?.startsWith('/') ? normalized : `/${normalized ?? ''}`;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Journey fixture ${label} body is incomplete.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Journey fixture ${label} is missing.`);
  }
  return value;
}

function assertCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 20) {
    throw new Error(`Journey fixture ${label} count must be an integer between 0 and 20.`);
  }
}

function stableHex(seed: string, label: string, length: number): string {
  return stableBytes(seed, label, Math.ceil(length / 2))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

function stableBytes(seed: string, label: string, length: number): number[] {
  let state = 2166136261;
  for (const character of `${seed}:${label}`) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return Array.from({ length }, (_, index) => {
    state ^= index + 1;
    state = Math.imul(state, 2246822519) >>> 0;
    state ^= state >>> 13;
    return state & 0xff;
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
