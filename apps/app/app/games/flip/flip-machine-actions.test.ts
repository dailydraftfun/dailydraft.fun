import { describe, expect, test } from 'bun:test';
import type { ConfirmationPhase } from '../../solana/confirmation';
import type {
  GachaPaymentIntent,
  GachaRipResult,
  PreparedGachaPaymentTransaction,
} from '../../solana/gacha-client';
import { GachaApiRequestError } from '../../solana/gacha-client';
import {
  inspectSignedWalletTransaction,
  type SignedWalletTransaction,
} from '../../solana/wallet-transaction';
import { WalletTransactionNotBroadcastError } from '../../solana/wallet-transaction-error';
import {
  claimOrRecoverSignature,
  confirmFlipRip,
  createFlipConfirmEvents,
  createFlipConfirmIo,
  createFlipResumeInput,
  decodeBase64Transaction,
  describeFlipError,
  type FlipConfirmEvents,
  type FlipConfirmIo,
  type FlipPrepareIo,
  flipConfirmOutcomeAction,
  flipOutcomeClearsRecovery,
  prepareFlipRip,
  reconcileSignedFlipRip,
  resumeFlipRip,
  sha256Hex,
  validatePreparedTransaction,
  verifyServerSeedProof,
} from './flip-machine-actions';
import type { FlipFundingPhase } from './flip-machine-flow';
import {
  attachFlipPaymentSignature,
  createUnknownFlipPaymentRecovery,
  readFlipPaymentRecovery,
  storeFlipPaymentRecovery,
} from './flip-payment-recovery';

const MACHINE_KEY = 'dailydraft-devnet-football-50000000';
const NOW = Date.parse('2026-07-26T00:00:00.000Z');
const SERVER_SEED = 'seed';
const SERVER_SEED_HASH = '19b25856e1c150ca834cffc8b59b23adbd0ec0389e58eb22b3b64768098d002b';
const UNSIGNED_TRANSACTION = Uint8Array.from([1, ...new Uint8Array(64), 104, 105]);
const RECOVERY_SIGNED_TRANSACTION = inspectSignedWalletTransaction(
  Uint8Array.from([1, ...new Uint8Array(64).fill(7), 2]),
);
const LOSING_SIGNED_TRANSACTION = inspectSignedWalletTransaction(
  Uint8Array.from([1, ...new Uint8Array(64).fill(9), 2]),
);

const INTENT = {
  amountCurrency: 'USDC',
  amountDecimals: 6,
  amountMinor: '50000000',
  destinationTokenAccount: 'treasury',
  expiresAt: '2026-07-26T00:05:00.000Z',
  intentId: 'gachaintent_1',
  machineKey: MACHINE_KEY,
  memoNonce: 'nonce',
  mint: 'usdc-mint',
  payerWallet: 'payer',
  resumed: false,
  signature: null,
  status: 'PENDING',
} satisfies GachaPaymentIntent;

const PREPARED = {
  amountMinor: '50000000',
  expectedMessageHash: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
  expiresAt: '2026-07-26T00:05:00.000Z',
  intentId: 'gachaintent_1',
  lastValidBlockHeight: '100',
  memoNonce: 'nonce',
  recentBlockhash: 'blockhash',
  serializedTransactionBase64: Buffer.from(UNSIGNED_TRANSACTION).toString('base64'),
  sourceTokenAccount: 'payer-ata',
} satisfies PreparedGachaPaymentTransaction;

const RESULT = {
  rip: { status: 'SETTLED' },
  serverSeed: SERVER_SEED,
  serverSeedHash: SERVER_SEED_HASH,
} as unknown as GachaRipResult;
const PROVIDER_FAILED_RESULT = {
  ...RESULT,
  rip: {
    failedAssetReference: `devnet:sports-pack:${MACHINE_KEY}:failed-card:${'a'.repeat(32)}`,
    failureReason: 'The provider did not deliver the selected card.',
    id: 'gacharip_failed',
    status: 'FAILED',
  },
} as GachaRipResult;

function signedTransaction(signature = 'signature'): SignedWalletTransaction {
  return {
    serializedTransaction: new Uint8Array([1, 2, 3]),
    signedTransactionBase64: btoa(signature),
    signature,
  };
}

/** Records every progress callback in order so the sequencing can be asserted. */
function recorder() {
  const balancesStale: string[] = [];
  const confirmationPhases: ConfirmationPhase[] = [];
  const fundingPhases: FlipFundingPhase[] = [];
  const notices: (string | null)[] = [];
  const signedTransactions: SignedWalletTransaction[] = [];
  const signatures: string[] = [];

  const events: FlipConfirmEvents = {
    onBalancesStale: (mint, sourceTokenAccount) =>
      balancesStale.push(`${mint}:${sourceTokenAccount}`),
    onBroadcastPending: () => true,
    onConfirmationPhase: (phase) => confirmationPhases.push(phase),
    onFundingPhase: (phase) => fundingPhases.push(phase),
    onNotice: (notice) => notices.push(notice),
    onPrepared: () => undefined,
    onSignedTransaction: (signed) => {
      signedTransactions.push(signed);
      return true;
    },
    onSignature: (signature) => signatures.push(signature),
  };

  return {
    balancesStale,
    confirmationPhases,
    events,
    fundingPhases,
    notices,
    signedTransactions,
    signatures,
  };
}

function confirmIo(overrides: Partial<FlipConfirmIo> = {}): FlipConfirmIo {
  return {
    broadcastTransaction: async () => 'signature',
    claimSignature: async (_intentId, signedTransactionBase64) => ({
      ...INTENT,
      resumed: true,
      signature: atob(signedTransactionBase64),
    }),
    createPaymentIntent: async () => ({ ...INTENT, resumed: true }),
    createRip: async () => RESULT,
    decodeTransaction: decodeBase64Transaction,
    hashBytes: async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    },
    now: () => NOW,
    prepareTransaction: async () => PREPARED,
    signTransaction: async () => signedTransaction(),
    track: async (_signature, options) => {
      options.onPhase('processed');
      return 'finalized';
    },
    verifyPayment: async () => ({
      amountMinor: '50000000',
      intentId: 'gachaintent_1',
      mintVerifiedOnChain: true,
      signature: 'signature',
      verifiedAt: '2026-07-26T00:00:01.000Z',
    }),
    ...overrides,
  };
}

const CONFIRM_INPUT = {
  address: 'payer',
  commitmentId: 'gachaseed_1',
  intent: INTENT,
  machineKey: MACHINE_KEY,
  oddsVersion: 3,
  prepared: PREPARED,
  serverSeedHash: SERVER_SEED_HASH,
  seed: 'f'.repeat(64),
};
const RESUME_INPUT = createFlipResumeInput(CONFIRM_INPUT);

describe('flip error copy', () => {
  test('prefers the thrown message and falls back for anything else', () => {
    expect(describeFlipError(new Error('Intent expired.'), 'fallback')).toBe('Intent expired.');
    // An `Error` with an empty message would render as a blank alert.
    expect(describeFlipError(new Error(''), 'fallback')).toBe('fallback');
    expect(describeFlipError('a string throw', 'fallback')).toBe('fallback');
  });
});

describe('transaction decoding', () => {
  test('decodes base64 to the raw bytes a wallet signs', () => {
    expect(decodeBase64Transaction(PREPARED.serializedTransactionBase64)).toEqual(
      UNSIGNED_TRANSACTION,
    );
  });

  test('hashes the exact serialized bytes with canonical lowercase SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('hi'))).toBe(PREPARED.expectedMessageHash);
  });
});

describe('flip machine funding wiring', () => {
  test('maps every progress event to the reducer and exact source-balance refresh', () => {
    const actions: unknown[] = [];
    const refreshed: string[] = [];
    const events = createFlipConfirmEvents(
      (action) => actions.push(action),
      (mint, sourceTokenAccount) => refreshed.push(`${mint}:${sourceTokenAccount}`),
    );

    events.onBalancesStale('usdc-mint', 'payer-ata');
    expect(events.onBroadcastPending(PREPARED)).toBe(true);
    events.onConfirmationPhase('confirmed');
    events.onFundingPhase('verifying');
    events.onNotice('Confirmed');
    events.onPrepared(PREPARED);
    expect(events.onSignedTransaction(signedTransaction())).toBe(true);
    events.onSignature('signature');

    expect(refreshed).toEqual(['usdc-mint:payer-ata']);
    expect(actions).toEqual([
      { phase: 'confirmed', type: 'confirmation-phase-changed' },
      { phase: 'verifying', type: 'funding-phase-changed' },
      { notice: 'Confirmed', type: 'notice-posted' },
      { prepared: PREPARED, type: 'prepared-updated' },
      { signature: 'signature', type: 'transaction-broadcast' },
    ]);
  });

  test('maps every terminal outcome to one explicit reducer transition', () => {
    expect(flipConfirmOutcomeAction({ result: RESULT, status: 'ripped' })).toEqual({
      result: RESULT,
      type: 'rip-succeeded',
    });
    expect(
      flipConfirmOutcomeAction({ result: PROVIDER_FAILED_RESULT, status: 'provider-failed' }),
    ).toEqual({
      result: PROVIDER_FAILED_RESULT,
      type: 'rip-provider-failed',
    });
    expect(flipConfirmOutcomeAction({ message: 'unknown', status: 'ambiguous' })).toEqual({
      message: 'unknown',
      type: 'transaction-broadcast-unknown',
    });
    expect(flipConfirmOutcomeAction({ message: 'declined', status: 'declined' })).toEqual({
      message: 'declined',
      type: 'rip-declined',
    });
    expect(flipConfirmOutcomeAction({ message: 'retry', status: 'retryable' })).toEqual({
      message: 'retry',
      type: 'transaction-failed',
    });
    expect(flipConfirmOutcomeAction({ message: 'failed', status: 'failed' })).toEqual({
      message: 'failed',
      type: 'rip-failed',
    });
  });

  test('releases durable recovery only for proven terminal outcomes', () => {
    expect(flipOutcomeClearsRecovery({ result: RESULT, status: 'ripped' })).toBe(true);
    expect(
      flipOutcomeClearsRecovery({ result: PROVIDER_FAILED_RESULT, status: 'provider-failed' }),
    ).toBe(true);
    expect(flipOutcomeClearsRecovery({ message: 'declined', status: 'declined' })).toBe(true);
    expect(flipOutcomeClearsRecovery({ message: 'failed on-chain', status: 'retryable' })).toBe(
      true,
    );
    expect(flipOutcomeClearsRecovery({ message: 'unknown', status: 'ambiguous' })).toBe(false);
    expect(flipOutcomeClearsRecovery({ message: 'failed', status: 'failed' })).toBe(false);
  });
});

describe('prepareFlipRip', () => {
  test('seals the seed before pricing so the odds are pre-committed', async () => {
    const calls: string[] = [];
    const io: FlipPrepareIo = {
      createPaymentIntent: async (machineKey, payerWallet) => {
        calls.push(`intent:${machineKey}:${payerWallet}`);
        return INTENT;
      },
      createSeedCommitment: async (machineKey) => {
        calls.push(`commit:${machineKey}`);
        return {
          commitmentId: 'gachaseed_1',
          expiresAt: '2026-07-26T00:05:00.000Z',
          serverSeedHash: 's'.repeat(64),
        };
      },
      prepareTransaction: async (intentId) => {
        calls.push(`prepare:${intentId}`);
        return PREPARED;
      },
    };

    const outcome = await prepareFlipRip({ address: 'payer', machineKey: MACHINE_KEY }, io);

    expect(outcome).toEqual({
      commitmentId: 'gachaseed_1',
      intent: INTENT,
      prepared: PREPARED,
      serverSeedHash: 's'.repeat(64),
      status: 'prepared',
    });
    expect(calls).toEqual([
      `commit:${MACHINE_KEY}`,
      `intent:${MACHINE_KEY}:payer`,
      'prepare:gachaintent_1',
    ]);
  });

  test('reports a failure at any step as recoverable copy rather than throwing', async () => {
    const outcome = await prepareFlipRip(
      { address: 'payer', machineKey: MACHINE_KEY },
      {
        createPaymentIntent: async () => INTENT,
        createSeedCommitment: async () => {
          throw new Error('The machine is closed.');
        },
        prepareTransaction: async () => PREPARED,
      },
    );

    expect(outcome).toEqual({ message: 'The machine is closed.', status: 'failed' });
  });

  test('resumes a server-claimed intent without preparing a second transfer', async () => {
    let prepared = 0;
    const resumedIntent = {
      ...INTENT,
      resumed: true,
      signature: 'claimed-signature',
    } satisfies GachaPaymentIntent;

    const outcome = await prepareFlipRip(
      { address: 'payer', machineKey: MACHINE_KEY },
      {
        createPaymentIntent: async () => resumedIntent,
        createSeedCommitment: async () => ({
          commitmentId: 'gachaseed_1',
          expiresAt: '2026-07-26T00:05:00.000Z',
          serverSeedHash: 's'.repeat(64),
        }),
        prepareTransaction: async () => {
          prepared += 1;
          return PREPARED;
        },
      },
    );

    expect(outcome).toEqual({
      commitmentId: 'gachaseed_1',
      intent: resumedIntent,
      serverSeedHash: 's'.repeat(64),
      status: 'resumed',
    });
    expect(prepared).toBe(0);
  });
});

describe('confirmFlipRip', () => {
  test('walks the funding phases and rips once the cluster settles', async () => {
    const { balancesStale, confirmationPhases, events, fundingPhases, notices, signatures } =
      recorder();
    let ripInput: unknown = null;
    const calls: string[] = [];

    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      events,
      confirmIo({
        createRip: async (input) => {
          calls.push('rip');
          ripInput = input;
          return RESULT;
        },
        track: async (_signature, options) => {
          calls.push('confirm');
          options.onPhase('confirmed');
          return 'confirmed';
        },
        verifyPayment: async () => {
          calls.push('verify');
          return {
            amountMinor: '50000000',
            intentId: 'gachaintent_1',
            mintVerifiedOnChain: true,
            signature: 'signature',
            verifiedAt: '2026-07-26T00:00:01.000Z',
          };
        },
      }),
    );

    expect(outcome).toEqual({ result: RESULT, status: 'ripped' });
    expect(fundingPhases).toEqual(['signing', 'confirming', 'verifying', 'ripping']);
    expect(signatures).toEqual(['signature']);
    expect(confirmationPhases).toEqual(['confirmed']);
    expect(notices).toEqual([
      null,
      'Deposit confirmed on Solana devnet. Revealing the committed rip…',
    ]);
    expect(balancesStale).toEqual(['usdc-mint:payer-ata']);
    expect(calls).toEqual(['confirm', 'verify', 'rip']);
    expect(ripInput).toEqual({
      commitmentId: 'gachaseed_1',
      machineKey: MACHINE_KEY,
      oddsVersion: 3,
      paymentIntentId: 'gachaintent_1',
      recipientWallet: 'payer',
      seed: 'f'.repeat(64),
    });
  });

  test('lets the first tab claim and broadcast while a different-signature loser broadcasts zero times', async () => {
    let authoritativeSignature: string | null = null;
    let firstBroadcasts = 0;
    let secondBroadcasts = 0;
    const sharedClaim = async (_intentId: string, signedTransactionBase64: string) => {
      const signature = atob(signedTransactionBase64);
      if (authoritativeSignature && authoritativeSignature !== signature) {
        throw new GachaApiRequestError('Another signature already claimed this intent.', 409);
      }
      authoritativeSignature = signature;
      return { ...INTENT, resumed: true, signature };
    };
    const activeIntent = async () => ({
      ...INTENT,
      resumed: true,
      signature: authoritativeSignature,
    });

    const winner = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        broadcastTransaction: async () => {
          firstBroadcasts += 1;
          return 'first-signature';
        },
        claimSignature: sharedClaim,
        createPaymentIntent: activeIntent,
        signTransaction: async () => signedTransaction('first-signature'),
        verifyPayment: async (_intentId, signature) => ({
          amountMinor: '50000000',
          intentId: 'gachaintent_1',
          mintVerifiedOnChain: true,
          signature,
          verifiedAt: '2026-07-26T00:00:01.000Z',
        }),
      }),
    );
    const loserEvents = recorder();
    const loser = await confirmFlipRip(
      CONFIRM_INPUT,
      loserEvents.events,
      confirmIo({
        broadcastTransaction: async () => {
          secondBroadcasts += 1;
          return 'second-signature';
        },
        claimSignature: sharedClaim,
        createPaymentIntent: activeIntent,
        signTransaction: async () => signedTransaction('second-signature'),
      }),
    );

    expect(winner.status).toBe('ripped');
    expect(loser).toEqual({
      message:
        'Another tab or device claimed this payment first. Its transfer is now the only one that can be reconciled.',
      status: 'failed',
    });
    expect(firstBroadcasts).toBe(1);
    expect(secondBroadcasts).toBe(0);
    expect(loserEvents.signatures).toEqual(['first-signature']);
  });

  test('replays the exact claimed signature after a lost claim response and broadcasts once', async () => {
    let broadcasts = 0;
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        broadcastTransaction: async () => {
          broadcasts += 1;
          return 'same-signature';
        },
        claimSignature: async () => {
          throw new TypeError('Claim response lost.');
        },
        createPaymentIntent: async () => ({
          ...INTENT,
          resumed: true,
          signature: 'same-signature',
        }),
        signTransaction: async () => signedTransaction('same-signature'),
        verifyPayment: async (_intentId, signature) => ({
          amountMinor: '50000000',
          intentId: 'gachaintent_1',
          mintVerifiedOnChain: true,
          signature,
          verifiedAt: '2026-07-26T00:00:01.000Z',
        }),
      }),
    );

    expect(outcome.status).toBe('ripped');
    expect(broadcasts).toBe(1);
  });

  test('keeps the intent locked when neither claim nor authority reconciliation answers', async () => {
    let broadcasts = 0;
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        broadcastTransaction: async () => {
          broadcasts += 1;
          return 'unreachable';
        },
        claimSignature: async () => {
          throw new TypeError('Claim response lost.');
        },
        createPaymentIntent: async () => {
          throw new TypeError('Authority read unavailable.');
        },
      }),
    );

    expect(outcome).toEqual({
      message:
        'The server signature claim could not be reconciled. Nothing was broadcast, and this intent remains locked for safe recovery.',
      status: 'failed',
    });
    expect(broadcasts).toBe(0);
  });

  test('rejects a mismatched RPC response while retaining the signed-byte recovery record', async () => {
    const { events, signatures } = recorder();
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      events,
      confirmIo({
        broadcastTransaction: async () => 'different-signature',
      }),
    );

    expect(outcome).toEqual({
      message: 'The Solana RPC returned a different transaction signature.',
      status: 'failed',
    });
    expect(signatures).toEqual([]);
  });

  test('fails a combined-only wallet before claim or broadcast', async () => {
    let claims = 0;
    let broadcasts = 0;
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        broadcastTransaction: async () => {
          broadcasts += 1;
          return 'unexpected';
        },
        claimSignature: async () => {
          claims += 1;
          return INTENT;
        },
        signTransaction: async () => {
          throw new WalletTransactionNotBroadcastError(
            'This wallet cannot safely pre-claim the payment. Nothing was broadcast.',
            'pre-broadcast-failure',
          );
        },
      }),
    );

    expect(outcome).toEqual({
      message: 'This wallet cannot safely pre-claim the payment. Nothing was broadcast.',
      status: 'declined',
    });
    expect(claims).toBe(0);
    expect(broadcasts).toBe(0);
  });

  test('generates a client seed when the caller supplies none', async () => {
    let seed = '';
    await confirmFlipRip(
      { ...CONFIRM_INPUT, seed: undefined },
      recorder().events,
      confirmIo({
        createRip: async (input) => {
          seed = input.seed;
          return RESULT;
        },
      }),
    );

    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  test('keeps an expired local poll locked because expiry is not proof of chain failure', async () => {
    const { events, fundingPhases } = recorder();
    let ripped = false;

    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      events,
      confirmIo({
        createRip: async () => {
          ripped = true;
          return RESULT;
        },
        track: async () => 'expired',
      }),
    );

    expect(outcome.status).toBe('failed');
    expect(ripped).toBe(false);
    expect(fundingPhases).not.toContain('ripping');
  });

  test('asks the server to terminalize a failed chain transaction before releasing recovery', async () => {
    const { events, fundingPhases } = recorder();
    let ripped = false;
    let verified = 0;

    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      events,
      confirmIo({
        createRip: async () => {
          ripped = true;
          return RESULT;
        },
        track: async () => 'failed',
        verifyPayment: async () => {
          verified += 1;
          throw new GachaApiRequestError(
            'TRANSACTION_EXECUTION_ERROR: the transfer failed on-chain',
            409,
          );
        },
      }),
    );

    expect(outcome.status).toBe('retryable');
    expect(flipOutcomeClearsRecovery(outcome)).toBe(true);
    expect(verified).toBe(1);
    expect(ripped).toBe(false);
    expect(fundingPhases).not.toContain('ripping');
  });

  test('keeps recovery locked when failed-chain server reconciliation is unavailable', async () => {
    let ripped = false;
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        createRip: async () => {
          ripped = true;
          return RESULT;
        },
        track: async () => 'failed',
        verifyPayment: async () => {
          throw new TypeError('Verification network unavailable.');
        },
      }),
    );

    expect(outcome).toEqual({
      message:
        'The failed transaction could not be reconciled with the server. This payment remains locked until reconciliation succeeds.',
      status: 'failed',
    });
    expect(flipOutcomeClearsRecovery(outcome)).toBe(false);
    expect(ripped).toBe(false);
  });

  test('reports a declined wallet prompt distinctly from a broken rip', async () => {
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        signTransaction: async () => {
          throw new WalletTransactionNotBroadcastError();
        },
      }),
    );

    expect(outcome).toEqual({
      message: 'You declined the transfer in your wallet. Nothing was charged.',
      status: 'declined',
    });
  });

  test('does not open the wallet when durable recovery cannot be saved', async () => {
    let signed = 0;
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      {
        ...recorder().events,
        onBroadcastPending: () => false,
      },
      confirmIo({
        signTransaction: async () => {
          signed += 1;
          return signedTransaction();
        },
      }),
    );

    expect(outcome).toEqual({
      message: 'Recovery could not be saved in this browser. Nothing was broadcast.',
      status: 'declined',
    });
    expect(signed).toBe(0);
  });

  test('persists signed bytes before claim and reload reconciliation never signs a new transfer', async () => {
    const firstEvents = recorder();
    let signRequests = 0;
    let claims = 0;
    let broadcasts = 0;
    const calls: string[] = [];
    const io = confirmIo({
      broadcastTransaction: async () => {
        broadcasts += 1;
        return RECOVERY_SIGNED_TRANSACTION.signature;
      },
      claimSignature: async () => {
        claims += 1;
        if (claims === 1) throw new TypeError('Claim response lost.');
        return { ...INTENT, resumed: true, signature: RECOVERY_SIGNED_TRANSACTION.signature };
      },
      createPaymentIntent: async () => {
        throw new TypeError('Authority read unavailable.');
      },
      signTransaction: async () => {
        signRequests += 1;
        return RECOVERY_SIGNED_TRANSACTION;
      },
      track: async (signature) => {
        calls.push(`track:${signature}`);
        return 'confirmed';
      },
      verifyPayment: async (_intentId, signature) => {
        calls.push(`verify:${signature}`);
        return {
          amountMinor: '50000000',
          intentId: 'gachaintent_1',
          mintVerifiedOnChain: true,
          signature,
          verifiedAt: '2026-07-26T00:00:01.000Z',
        };
      },
    });

    const interrupted = await confirmFlipRip(CONFIRM_INPUT, firstEvents.events, io);

    expect(interrupted).toEqual({
      message:
        'The server signature claim could not be reconciled. Nothing was broadcast, and this intent remains locked for safe recovery.',
      status: 'failed',
    });
    expect(firstEvents.signatures).toEqual([]);
    expect(firstEvents.signedTransactions).toHaveLength(1);
    expect(broadcasts).toBe(0);

    const saved = firstEvents.signedTransactions[0] as SignedWalletTransaction;
    const resumed = await reconcileSignedFlipRip(
      { ...RESUME_INPUT, signedTransactionBase64: saved.signedTransactionBase64 },
      saved.signature,
      recorder().events,
      io,
    );

    expect(resumed.status).toBe('ripped');
    expect(signRequests).toBe(1);
    expect(claims).toBe(2);
    expect(broadcasts).toBe(1);
    expect(calls).toEqual([
      `track:${RECOVERY_SIGNED_TRANSACTION.signature}`,
      `verify:${RECOVERY_SIGNED_TRANSACTION.signature}`,
    ]);
  });

  test('does not claim or broadcast when exact signed bytes cannot be durably saved', async () => {
    let claims = 0;
    let broadcasts = 0;
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      {
        ...recorder().events,
        onSignedTransaction: () => false,
      },
      confirmIo({
        broadcastTransaction: async () => {
          broadcasts += 1;
          return 'unexpected';
        },
        claimSignature: async () => {
          claims += 1;
          return { ...INTENT, resumed: true, signature: 'unexpected' };
        },
      }),
    );

    expect(outcome).toEqual({
      message:
        'The signed payment could not be saved for recovery. Nothing was claimed or broadcast.',
      status: 'failed',
    });
    expect(claims).toBe(0);
    expect(broadcasts).toBe(0);
  });

  test('keeps signed reload recovery locked when claim and authority replay stay offline', async () => {
    let signed = 0;
    let broadcasts = 0;
    const outcome = await reconcileSignedFlipRip(
      {
        ...RESUME_INPUT,
        signedTransactionBase64: RECOVERY_SIGNED_TRANSACTION.signedTransactionBase64,
      },
      RECOVERY_SIGNED_TRANSACTION.signature,
      recorder().events,
      confirmIo({
        broadcastTransaction: async () => {
          broadcasts += 1;
          return RECOVERY_SIGNED_TRANSACTION.signature;
        },
        claimSignature: async () => {
          throw new TypeError('Claim unavailable.');
        },
        createPaymentIntent: async () => {
          throw new TypeError('Authority unavailable.');
        },
        signTransaction: async () => {
          signed += 1;
          return signedTransaction('unexpected');
        },
      }),
    );

    expect(outcome).toEqual({ message: 'Claim unavailable.', status: 'failed' });
    expect(flipOutcomeClearsRecovery(outcome)).toBe(false);
    expect(signed).toBe(0);
    expect(broadcasts).toBe(0);
  });

  test('rejects mismatched persisted bytes before claim even when the stored signature is authoritative', async () => {
    let claims = 0;
    let broadcasts = 0;
    const outcome = await reconcileSignedFlipRip(
      {
        ...RESUME_INPUT,
        signedTransactionBase64: LOSING_SIGNED_TRANSACTION.signedTransactionBase64,
      },
      RECOVERY_SIGNED_TRANSACTION.signature,
      recorder().events,
      confirmIo({
        broadcastTransaction: async () => {
          broadcasts += 1;
          return RECOVERY_SIGNED_TRANSACTION.signature;
        },
        claimSignature: async () => {
          claims += 1;
          return {
            ...INTENT,
            resumed: true,
            signature: RECOVERY_SIGNED_TRANSACTION.signature,
          };
        },
      }),
    );

    expect(outcome).toEqual({
      message:
        'The saved signed payment does not match its recovery signature. Recovery remains locked.',
      status: 'failed',
    });
    expect(flipOutcomeClearsRecovery(outcome)).toBe(false);
    expect(claims).toBe(0);
    expect(broadcasts).toBe(0);
  });

  test('rejects a different RPC signature while replaying saved signed bytes', async () => {
    const outcome = await reconcileSignedFlipRip(
      {
        ...RESUME_INPUT,
        signedTransactionBase64: RECOVERY_SIGNED_TRANSACTION.signedTransactionBase64,
      },
      RECOVERY_SIGNED_TRANSACTION.signature,
      recorder().events,
      confirmIo({
        broadcastTransaction: async () => 'different-signature',
        claimSignature: async () => ({
          ...INTENT,
          resumed: true,
          signature: RECOVERY_SIGNED_TRANSACTION.signature,
        }),
      }),
    );

    expect(outcome).toEqual({
      message: 'The Solana RPC returned a different transaction signature.',
      status: 'failed',
    });
  });

  test('follows a different server-authoritative signature on reload without broadcasting saved bytes', async () => {
    let broadcasts = 0;
    const tracked: string[] = [];
    const outcome = await reconcileSignedFlipRip(
      {
        ...RESUME_INPUT,
        signedTransactionBase64: RECOVERY_SIGNED_TRANSACTION.signedTransactionBase64,
      },
      RECOVERY_SIGNED_TRANSACTION.signature,
      recorder().events,
      confirmIo({
        broadcastTransaction: async () => {
          broadcasts += 1;
          return RECOVERY_SIGNED_TRANSACTION.signature;
        },
        claimSignature: async () => ({
          ...INTENT,
          resumed: true,
          signature: 'authoritative-signature',
        }),
        track: async (signature) => {
          tracked.push(signature);
          return 'confirmed';
        },
        verifyPayment: async (_intentId, signature) => ({
          amountMinor: '50000000',
          intentId: 'gachaintent_1',
          mintVerifiedOnChain: true,
          signature,
          verifiedAt: '2026-07-26T00:00:01.000Z',
        }),
      }),
    );

    expect(outcome.status).toBe('ripped');
    expect(broadcasts).toBe(0);
    expect(tracked).toEqual(['authoritative-signature']);
  });

  test('fails safely when a sign-only wallet transport disconnects before broadcast', async () => {
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        signTransaction: async () => {
          throw new TypeError('Wallet transport disconnected.');
        },
      }),
    );

    expect(outcome).toEqual({
      message: 'Wallet transport disconnected.',
      status: 'declined',
    });
  });

  test('surfaces a rip failure with the server message', async () => {
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        createRip: async () => {
          throw new Error('The seed commitment expired.');
        },
      }),
    );

    expect(outcome).toEqual({ message: 'The seed commitment expired.', status: 'failed' });
  });

  test('terminalizes a provider failure without presenting it as a revealed card', async () => {
    const recorded = recorder();
    const outcome = await resumeFlipRip(
      { ...RESUME_INPUT, sourceTokenAccount: null },
      'existing-signature',
      recorded.events,
      confirmIo({ createRip: async () => PROVIDER_FAILED_RESULT }),
    );

    expect(outcome).toEqual({
      result: PROVIDER_FAILED_RESULT,
      status: 'provider-failed',
    });
    expect(recorded.balancesStale).toEqual(['usdc-mint:null']);
    expect(flipOutcomeClearsRecovery(outcome)).toBe(true);
  });

  test('continues a server-verified payment after local tracking reports failure', async () => {
    let verificationCalls = 0;
    const outcome = await resumeFlipRip(
      RESUME_INPUT,
      'existing-signature',
      recorder().events,
      confirmIo({
        track: async () => 'failed',
        verifyPayment: async () => {
          verificationCalls += 1;
          return {
            amountMinor: '50000000',
            intentId: INTENT.intentId,
            mintVerifiedOnChain: true,
            signature: 'existing-signature',
            verifiedAt: '2026-07-26T00:00:01.000Z',
          };
        },
      }),
    );

    expect(outcome.status).toBe('ripped');
    expect(verificationCalls).toBe(1);
  });

  test('refreshes an expired unsigned transaction before opening the wallet', async () => {
    const refreshed = {
      ...PREPARED,
      expiresAt: '2026-07-26T00:10:00.000Z',
      recentBlockhash: 'fresh-blockhash',
    };
    const prepared: PreparedGachaPaymentTransaction[] = [];
    let signed = 0;
    const outcome = await confirmFlipRip(
      {
        ...CONFIRM_INPUT,
        prepared: { ...PREPARED, expiresAt: '2026-07-25T23:59:00.000Z' },
      },
      {
        ...recorder().events,
        onPrepared: (value) => prepared.push(value),
      },
      confirmIo({
        hashBytes: async (bytes) =>
          bytes.length === 2 ? refreshed.expectedMessageHash : SERVER_SEED_HASH,
        prepareTransaction: async () => refreshed,
        signTransaction: async () => {
          signed += 1;
          return signedTransaction();
        },
      }),
    );

    expect(outcome.status).toBe('ripped');
    expect(prepared).toEqual([refreshed]);
    expect(signed).toBe(1);
  });

  test('rejects mismatched reviewed terms before opening the wallet', async () => {
    let signed = false;
    const outcome = await confirmFlipRip(
      { ...CONFIRM_INPUT, prepared: { ...PREPARED, amountMinor: '50000001' } },
      recorder().events,
      confirmIo({
        signTransaction: async () => {
          signed = true;
          return signedTransaction();
        },
      }),
    );

    expect(outcome).toEqual({
      message: 'The unsigned transaction does not match the reviewed payment intent.',
      status: 'failed',
    });
    expect(signed).toBe(false);
  });

  test('resumes a broadcast signature without asking the wallet to sign again', async () => {
    const calls: string[] = [];
    const outcome = await resumeFlipRip(
      RESUME_INPUT,
      'existing-signature',
      recorder().events,
      confirmIo({
        createRip: async () => {
          calls.push('rip');
          return RESULT;
        },
        signTransaction: async () => {
          calls.push('sign');
          return signedTransaction('unexpected');
        },
        track: async () => {
          calls.push('confirm');
          return 'confirmed';
        },
        verifyPayment: async () => {
          calls.push('verify');
          return {
            amountMinor: '50000000',
            intentId: 'gachaintent_1',
            mintVerifiedOnChain: true,
            signature: 'existing-signature',
            verifiedAt: '2026-07-26T00:00:01.000Z',
          };
        },
      }),
    );

    expect(outcome.status).toBe('ripped');
    expect(calls).toEqual(['confirm', 'verify', 'rip']);
  });

  test('reloads a durable signature into verification without a second wallet request', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const signature = 'Z'.repeat(88);
    const record = attachFlipPaymentSignature(
      createUnknownFlipPaymentRecovery({
        commitmentId: CONFIRM_INPUT.commitmentId,
        intentId: CONFIRM_INPUT.intent.intentId,
        machineKey: CONFIRM_INPUT.machineKey,
        mint: 'M'.repeat(32),
        oddsVersion: CONFIRM_INPUT.oddsVersion,
        payerWallet: 'P'.repeat(32),
        serverSeedHash: CONFIRM_INPUT.serverSeedHash,
        sourceTokenAccount: 'S'.repeat(32),
      }),
      signature,
    );
    storeFlipPaymentRecovery(storage, record);
    const restored = readFlipPaymentRecovery(storage);
    if (restored.status !== 'valid') throw new Error('Expected a valid reload record.');
    let signed = 0;
    const calls: string[] = [];

    const outcome = await resumeFlipRip(
      {
        address: restored.record.payerWallet,
        commitmentId: restored.record.commitmentId,
        intentId: restored.record.intentId,
        machineKey: restored.record.machineKey,
        mint: restored.record.mint,
        oddsVersion: restored.record.oddsVersion,
        serverSeedHash: restored.record.serverSeedHash,
        sourceTokenAccount: restored.record.sourceTokenAccount,
      },
      restored.record.signature as string,
      recorder().events,
      confirmIo({
        signTransaction: async () => {
          signed += 1;
          return signedTransaction('unexpected');
        },
        track: async (restoredSignature) => {
          calls.push(`track:${restoredSignature}`);
          return 'confirmed';
        },
        verifyPayment: async (_intentId, restoredSignature) => {
          calls.push(`verify:${restoredSignature}`);
          return {
            amountMinor: '50000000',
            intentId: CONFIRM_INPUT.intent.intentId,
            mintVerifiedOnChain: true,
            signature: restoredSignature,
            verifiedAt: '2026-07-26T00:00:01.000Z',
          };
        },
      }),
    );

    expect(outcome.status).toBe('ripped');
    expect(signed).toBe(0);
    expect(calls).toEqual([`track:${signature}`, `verify:${signature}`]);
  });

  test('surfaces a disconnected recovery failure without opening the signer', async () => {
    let signed = 0;
    const outcome = await resumeFlipRip(
      { ...RESUME_INPUT, sourceTokenAccount: null },
      'existing-signature',
      recorder().events,
      confirmIo({
        signTransaction: async () => {
          signed += 1;
          return signedTransaction();
        },
        track: async () => {
          throw new TypeError('RPC unavailable.');
        },
      }),
    );

    expect(outcome).toEqual({ message: 'RPC unavailable.', status: 'failed' });
    expect(signed).toBe(0);
  });

  test('holds a settled rip in recovery when the server seed proof does not match', async () => {
    const outcome = await confirmFlipRip(
      CONFIRM_INPUT,
      recorder().events,
      confirmIo({
        createRip: async () =>
          ({
            ...RESULT,
            serverSeedHash: '0'.repeat(64),
          }) as GachaRipResult,
      }),
    );

    expect(outcome).toEqual({
      message: 'The revealed server seed does not match the pre-payment commitment.',
      status: 'failed',
    });
  });
});

describe('prepared transaction validation', () => {
  test('rejects an expired transaction before hashing or signing', async () => {
    expect(
      validatePreparedTransaction(
        INTENT,
        { ...PREPARED, expiresAt: '2026-07-25T23:59:59.000Z' },
        new Uint8Array(),
        NOW,
      ),
    ).rejects.toThrow('The unsigned transaction expired before approval.');
  });

  test('rejects changed bytes even when the reviewed fields match', async () => {
    await expect(
      validatePreparedTransaction(INTENT, PREPARED, UNSIGNED_TRANSACTION, NOW, async () =>
        '0'.repeat(64),
      ),
    ).rejects.toThrow('changed after it was prepared');
  });
});

describe('signature claim authority', () => {
  test('requires an intent id before attempting claim recovery', async () => {
    await expect(
      claimOrRecoverSignature(
        { address: CONFIRM_INPUT.address, machineKey: CONFIRM_INPUT.machineKey },
        signedTransaction(),
        confirmIo(),
      ),
    ).rejects.toThrow('payment intent id is required');
  });

  test('rejects a malformed claim response when the authority read is unavailable', async () => {
    await expect(
      claimOrRecoverSignature(CONFIRM_INPUT, signedTransaction(), {
        claimSignature: async () => ({ ...INTENT, resumed: false, signature: 'signature' }),
        createPaymentIntent: async () => {
          throw new TypeError('Authority unavailable.');
        },
      }),
    ).rejects.toThrow('mismatched active intent');
  });

  test('preserves the original claim failure when createIntent returns another intent', async () => {
    await expect(
      claimOrRecoverSignature(CONFIRM_INPUT, signedTransaction(), {
        claimSignature: async () => {
          throw new Error('Claim rejected.');
        },
        createPaymentIntent: async () => ({
          ...INTENT,
          intentId: 'gachaintent_2',
          resumed: true,
          signature: 'other-signature',
        }),
      }),
    ).rejects.toThrow('Claim rejected.');
  });
});

describe('server seed proof', () => {
  test('rejects a settled rip that omits its seed reveal', async () => {
    expect(verifyServerSeedProof({} as GachaRipResult, SERVER_SEED_HASH)).rejects.toThrow(
      'The settled rip did not reveal its server seed proof.',
    );
  });

  test('rejects a revealed seed whose bytes do not hash to the commitment', async () => {
    await expect(
      verifyServerSeedProof(RESULT, SERVER_SEED_HASH, async () => '0'.repeat(64)),
    ).rejects.toThrow('failed commitment verification');
  });
});

describe('createFlipConfirmIo', () => {
  test('binds the wallet signer to the real network calls', async () => {
    const signed: Uint8Array[] = [];
    const io = createFlipConfirmIo(async (bytes) => {
      signed.push(bytes);
      return signedTransaction();
    });

    expect(await io.signTransaction(new Uint8Array([1, 2]))).toEqual(signedTransaction());
    expect(Array.from(signed[0] as Uint8Array)).toEqual([1, 2]);
    expect(typeof io.broadcastTransaction).toBe('function');
    expect(typeof io.claimSignature).toBe('function');
    expect(typeof io.createPaymentIntent).toBe('function');
    expect(io.decodeTransaction(PREPARED.serializedTransactionBase64)).toEqual(
      UNSIGNED_TRANSACTION,
    );
    expect(typeof io.createRip).toBe('function');
    expect(typeof io.hashBytes).toBe('function');
    expect(io.now()).toBeGreaterThan(0);
    expect(typeof io.prepareTransaction).toBe('function');
    expect(typeof io.track).toBe('function');
    expect(typeof io.verifyPayment).toBe('function');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ result: RECOVERY_SIGNED_TRANSACTION.signature })) as unknown as typeof fetch;
    try {
      await expect(
        io.broadcastTransaction(RECOVERY_SIGNED_TRANSACTION.serializedTransaction),
      ).resolves.toBe(RECOVERY_SIGNED_TRANSACTION.signature);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
