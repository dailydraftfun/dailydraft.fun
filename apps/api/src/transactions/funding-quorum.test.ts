import { describe, expect, test } from 'bun:test';

import { resolveFundingQuorum } from './prisma-transaction-monitor.repository.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';

describe('funding reconciliation quorum', () => {
  test('keeps the duel committing after the first finalized side', () => {
    expect(resolveFundingQuorum(quorumInput(CREATOR, []))).toBe('pending');
  });

  test('completes only after the other participant finalizes', () => {
    expect(resolveFundingQuorum(quorumInput(OPPONENT, [CREATOR]))).toBe('complete');
  });

  test('is independent of participant finalization order', () => {
    expect(resolveFundingQuorum(quorumInput(CREATOR, [OPPONENT]))).toBe('complete');
  });

  test('rejects duplicate-wallet quorum', () => {
    expect(resolveFundingQuorum(quorumInput(CREATOR, [CREATOR]))).toBe('invalid');
  });

  test('replays an already finalized transaction idempotently', () => {
    expect(
      resolveFundingQuorum({
        ...quorumInput(CREATOR, [OPPONENT]),
        currentAlreadyFinalized: true,
      }),
    ).toBe('idempotent');
  });
});

function quorumInput(currentWallet: string, finalizedWallets: string[]) {
  return {
    creatorWallet: CREATOR,
    currentAlreadyFinalized: false,
    currentWallet,
    finalizedWallets,
    opponentWallet: OPPONENT,
  };
}
