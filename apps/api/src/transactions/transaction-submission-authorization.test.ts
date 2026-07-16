import { describe, expect, test } from 'bun:test';

import {
  assertDuelReconciliationActor,
  assertWalletSubmissionActor,
} from './prisma-transaction-monitor.repository.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const OTHER_WALLET = '11111111111111111111111111111111';

describe('transaction submission wallet binding', () => {
  test('allows a participant session to submit its own prepared signature', () => {
    expect(() =>
      assertWalletSubmissionActor({
        actorWallet: CREATOR,
        creatorWallet: CREATOR,
        expectedSigner: CREATOR,
        opponentWallet: OPPONENT,
        transactionWallet: CREATOR,
      }),
    ).not.toThrow();
  });

  test('rejects a session when the prepared intent expects another signer', () => {
    expect(() =>
      assertWalletSubmissionActor({
        actorWallet: CREATOR,
        creatorWallet: CREATOR,
        expectedSigner: OPPONENT,
        opponentWallet: OPPONENT,
        transactionWallet: CREATOR,
      }),
    ).toThrow('another signer or duel participant');
  });

  test('rejects a signer that is not a duel participant', () => {
    expect(() =>
      assertWalletSubmissionActor({
        actorWallet: OTHER_WALLET,
        creatorWallet: CREATOR,
        expectedSigner: OTHER_WALLET,
        opponentWallet: OPPONENT,
        transactionWallet: OTHER_WALLET,
      }),
    ).toThrow('another signer or duel participant');
  });

  test('keeps authenticated server orchestration available', () => {
    expect(() =>
      assertWalletSubmissionActor({
        creatorWallet: CREATOR,
        expectedSigner: OTHER_WALLET,
        opponentWallet: OPPONENT,
        transactionWallet: OTHER_WALLET,
      }),
    ).not.toThrow();
  });
});

describe('participant reconciliation wallet binding', () => {
  test('allows either duel participant to advance finality checks', () => {
    for (const actorWallet of [CREATOR, OPPONENT]) {
      expect(() =>
        assertDuelReconciliationActor({
          actorWallet,
          creatorWallet: CREATOR,
          opponentWallet: OPPONENT,
        }),
      ).not.toThrow();
    }
  });

  test('rejects a wallet that is not part of the duel', () => {
    expect(() =>
      assertDuelReconciliationActor({
        actorWallet: OTHER_WALLET,
        creatorWallet: CREATOR,
        opponentWallet: OPPONENT,
      }),
    ).toThrow('cannot reconcile another duel');
  });

  test('keeps integration-key reconciliation available', () => {
    expect(() =>
      assertDuelReconciliationActor({
        creatorWallet: CREATOR,
        opponentWallet: OPPONENT,
      }),
    ).not.toThrow();
  });
});
