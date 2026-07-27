import {
  createRgsExternalCommitment,
  hashRgsValue,
  type RgsExternalCommitment,
  type RgsJsonValue,
} from '@dailydraft/contracts';
import { DuelSide } from '@dailydraft/db';

export type DuelRgsOperationInput = {
  generateIdempotencyKey: string;
  openIdempotencyKey: string;
  provider: string;
  providerPackId: string;
  recipientWallet: string;
  side: DuelSide | 'creator' | 'opponent';
};

export function createDuelRgsCommitment(input: {
  duelId: string;
  operations: readonly DuelRgsOperationInput[];
  packId: string;
  providerMode: string;
  rulesHash: string;
}): RgsExternalCommitment {
  return createRgsExternalCommitment({
    configHash: hashRgsValue({
      packId: input.packId,
      providerMode: input.providerMode,
      providerPackIds: [
        ...new Set(input.operations.map((operation) => operation.providerPackId)),
      ].sort(),
    }),
    mode: 'duel',
    request: duelRgsRequest(input.operations),
    roundId: input.duelId,
    rulesHash: input.rulesHash,
  });
}

export function duelRgsRequest(
  operations: readonly DuelRgsOperationInput[],
): readonly RgsJsonValue[] {
  return [...operations]
    .sort((left, right) => rgsSide(left.side).localeCompare(rgsSide(right.side)))
    .map((operation) => ({
      generateIdempotencyKey: operation.generateIdempotencyKey,
      openIdempotencyKey: operation.openIdempotencyKey,
      provider: operation.provider,
      providerPackId: operation.providerPackId,
      recipientWallet: operation.recipientWallet,
      side: rgsSide(operation.side),
    }));
}

function rgsSide(side: DuelRgsOperationInput['side']): 'creator' | 'opponent' {
  return side === DuelSide.CREATOR || side === 'creator' ? 'creator' : 'opponent';
}
