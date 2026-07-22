import { createHash } from 'node:crypto';

export type ContractAuth = 'none' | 'wallet-or-integration';

export type ContractOperation = {
  auth: ContractAuth;
  errorStatuses: readonly number[];
  idempotencyRequired: boolean;
  method: 'get' | 'post';
  operationId: string;
  path: string;
  requestRequired: boolean;
  successStatus: number;
};

export const OPENAPI_CONTRACT_VERSION = '0.2.0-devnet';

export const contractValues = {
  challengeId: 'authc_0123456789abcdef0123456789abcdef',
  creatorWallet: '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1',
  duelId: 'duel_contractfixture01',
  idempotencyKey: 'contract-fixture-key-0001',
  opponentWallet: 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW',
  sessionToken: 'contract_wallet_session',
} as const;

const pack = {
  active: true,
  id: 'pokemon_50',
  imageUrl: 'https://images.example.test/pokemon-50.png',
  name: 'Pokemon $50',
  price: { amount: '50000000', currency: 'USDC', decimals: 6 },
  provider: 'OpenPacks Duel Devnet',
  providerPackId: 'pokemon-50-devnet',
  valuationPolicyHash: 'a'.repeat(64),
} as const;

export const contractFixtures = {
  createDuel: {
    request: {
      analyticsSessionId: 'anon_0123456789abcdef0123456789abcdef',
      creatorWallet: contractValues.creatorWallet,
      expiresAt: '2026-07-20T12:15:00.000Z',
      matchmakingMode: 'direct',
      opponentWallet: contractValues.opponentWallet,
      packId: pack.id,
    },
  },
  duelStatus: {
    response: {
      cancellationReason: null,
      createdAt: '2026-07-20T12:00:00.000Z',
      creatorWallet: contractValues.creatorWallet,
      environment: 'solana-devnet',
      escrowAddress: null,
      expiresAt: '2026-07-20T12:15:00.000Z',
      houseOpponent: false,
      id: contractValues.duelId,
      matchmakingMode: 'direct',
      opponentJoinedAt: '2026-07-20T12:01:00.000Z',
      opponentWallet: contractValues.opponentWallet,
      pack,
      providerMode: 'openpacksduel-devnet',
      result: null,
      stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
      status: 'matched',
      transactionSignature: null,
      updatedAt: '2026-07-20T12:01:00.000Z',
      version: 3,
      winnerWallet: null,
    },
  },
  health: {
    response: {
      dependencies: { database: 'ok' },
      service: 'openpacksduel-api',
      status: 'ok',
      version: OPENAPI_CONTRACT_VERSION,
    },
  },
  problem: {
    response: {
      detail: 'The contract fixture request was rejected',
      requestId: 'req_contract_fixture',
      status: 409,
      title: 'Conflict',
      type: 'https://openpacksduel.com/problems/conflict',
    },
  },
  publicProof: {
    response: {
      actions: {
        primary: { href: `/duel/${contractValues.duelId}`, label: 'Return to duel' },
        rematch: null,
        share: { href: `/duel/${contractValues.duelId}`, label: 'Share duel' },
      },
      availability: {
        complete: false,
        missing: ['Finalized settlement evidence'],
      },
      cardActions: {
        availability: 'hidden',
        cards: [],
        reason: 'duel-not-settled',
        receiptHref: `/duel/${contractValues.duelId}/receipt`,
        schemaVersion: 'openpacksduel.card-actions.v1',
      },
      custody: {
        cardAssets: {
          detail: 'Provider results are not finalized.',
          status: 'not-recorded',
        },
        platformFee: {
          asset: 'WSOL',
          escrowAddress: null,
          status: 'not-started',
        },
      },
      duel: {
        createdAt: '2026-07-20T12:00:00.000Z',
        expiresAt: '2026-07-20T12:15:00.000Z',
        id: contractValues.duelId,
        mode: 'direct',
        network: 'solana-devnet',
        observedAt: '2026-07-20T12:01:00.000Z',
        status: 'matched',
      },
      fees: {
        asset: 'WSOL',
        finalizedSides: 0,
        perSideAmountLamports: null,
        requiredSides: 2,
        totalFinalizedAmountLamports: null,
      },
      pack: {
        id: pack.id,
        name: pack.name,
        provider: pack.provider,
        providerMode: 'openpacksduel-devnet',
        providerPackId: pack.providerPackId,
        tier: pack.price,
      },
      participants: {
        creator: {
          address: contractValues.creatorWallet,
          display: '9xQe…z9gJ1',
          role: 'creator',
        },
        opponent: {
          address: contractValues.opponentWallet,
          display: 'Gk8Z…tBMQyW',
          role: 'opponent',
        },
      },
      privacy: {
        indexable: false,
        reason: 'Wallet-linked duel receipts are excluded from search indexing.',
      },
      recovery: { alerts: [], status: 'none' },
      references: { provider: [], solana: [] },
      result: null,
      schemaVersion: 'openpacksduel.receipt.v1',
    },
  },
  transactionPreparation: {
    request: {
      action: 'fund',
      wallet: contractValues.creatorWallet,
    },
    response: {
      action: 'fund',
      chain: 'solana:devnet',
      cluster: 'devnet',
      duelId: contractValues.duelId,
      escrowAddress: 'Escrow111111111111111111111111111111111',
      expiresAt: '2026-07-20T12:05:00.000Z',
      feeAmountLamports: '1000000',
      feeAmountSol: '0.001',
      feeRecipient: 'Fee1111111111111111111111111111111111111',
      fundingSide: 'creator',
      id: 'tx_contractfixture01',
      lastValidBlockHeight: '12345',
      paymentMint: 'So11111111111111111111111111111111111111112',
      programId: 'Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS',
      recentBlockhash: '11111111111111111111111111111111',
      serializedTransactionBase64: 'AQIDBA==',
      status: 'prepared',
      wallet: contractValues.creatorWallet,
      warnings: ['Verify the devnet transaction before signing.'],
    },
  },
  walletAuthentication: {
    challengeRequest: { wallet: contractValues.creatorWallet },
    challengeResponse: {
      chain: 'solana:devnet',
      challengeId: contractValues.challengeId,
      domain: 'openpacksduel.example.test',
      expiresAt: '2026-07-20T12:05:00.000Z',
      message: 'Sign in to OpenPacks Duel on Solana devnet.',
      uri: 'https://openpacksduel.example.test',
      wallet: contractValues.creatorWallet,
    },
    sessionRequest: {
      challengeId: contractValues.challengeId,
      signature: 'AQIDBA==',
      wallet: contractValues.creatorWallet,
    },
    sessionResponse: {
      expiresAt: '2026-07-20T12:15:00.000Z',
      network: 'solana-devnet',
      token: contractValues.sessionToken,
      wallet: contractValues.creatorWallet,
    },
  },
} as const;

export const contractOperations = [
  {
    auth: 'none',
    errorStatuses: [429, 503],
    idempotencyRequired: false,
    method: 'get',
    operationId: 'getHealth',
    path: '/health',
    requestRequired: false,
    successStatus: 200,
  },
  {
    auth: 'none',
    errorStatuses: [400, 429],
    idempotencyRequired: false,
    method: 'post',
    operationId: 'createWalletChallenge',
    path: '/auth/challenges',
    requestRequired: true,
    successStatus: 201,
  },
  {
    auth: 'none',
    errorStatuses: [400, 401, 409],
    idempotencyRequired: false,
    method: 'post',
    operationId: 'createWalletSession',
    path: '/auth/sessions',
    requestRequired: true,
    successStatus: 201,
  },
  {
    auth: 'wallet-or-integration',
    errorStatuses: [400, 401, 403, 409, 429, 503],
    idempotencyRequired: true,
    method: 'post',
    operationId: 'createDuel',
    path: '/duels',
    requestRequired: true,
    successStatus: 201,
  },
  {
    auth: 'wallet-or-integration',
    errorStatuses: [401, 403, 404],
    idempotencyRequired: false,
    method: 'get',
    operationId: 'getDuel',
    path: '/duels/{duelId}',
    requestRequired: false,
    successStatus: 200,
  },
  {
    auth: 'wallet-or-integration',
    errorStatuses: [400, 401, 403, 404, 409, 503],
    idempotencyRequired: true,
    method: 'post',
    operationId: 'prepareDuelTransaction',
    path: '/duels/{duelId}/transactions',
    requestRequired: true,
    successStatus: 201,
  },
  {
    auth: 'none',
    errorStatuses: [404],
    idempotencyRequired: false,
    method: 'get',
    operationId: 'getPublicDuelReceipt',
    path: '/duels/{duelId}/receipt',
    requestRequired: false,
    successStatus: 200,
  },
] as const satisfies readonly ContractOperation[];

export const CONTRACT_FIXTURE_VERSION = '2026-07-20.v1+f69a52e94bf6';

export function contractFixtureFingerprint(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        contractFixtures,
        contractOperations,
        openApiVersion: OPENAPI_CONTRACT_VERSION,
      }),
    )
    .digest('hex')
    .slice(0, 12);
}

export function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function compareRouteInventories(
  implementation: ReadonlySet<string>,
  specification: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const route of [...implementation].sort()) {
    if (!specification.has(route)) errors.push(`Implementation-only route: ${route}`);
  }
  for (const route of [...specification].sort()) {
    if (!implementation.has(route)) errors.push(`Specification-only route: ${route}`);
  }
  return errors;
}
