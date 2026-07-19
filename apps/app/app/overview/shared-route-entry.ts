import type { PublicDuelReceipt } from '../duel/public-proof-client';
import type { DuelLobbyEntry } from '../duel-arena';

type SharedRouteReceipt = {
  duel: Pick<PublicDuelReceipt['duel'], 'id' | 'mode' | 'status'>;
  pack: Pick<PublicDuelReceipt['pack'], 'tier'>;
  participants: {
    creator: Pick<PublicDuelReceipt['participants']['creator'], 'display'>;
    opponent: Pick<NonNullable<PublicDuelReceipt['participants']['opponent']>, 'display'> | null;
  };
};

export function buildSharedDuelEntry(
  receipt: SharedRouteReceipt,
  action: 'accept' | 'rematch',
): DuelLobbyEntry | null {
  if (action === 'accept') {
    if (receipt.duel.status !== 'waiting' || receipt.duel.mode !== 'direct') return null;
    return {
      action,
      duelId: receipt.duel.id,
      mode: 'direct',
      opponentLabel: receipt.participants.creator.display,
      tier: moneyValue(receipt.pack.tier),
    };
  }

  if (
    receipt.duel.status !== 'settled' ||
    receipt.duel.mode === 'house' ||
    !receipt.participants.opponent
  ) {
    return null;
  }
  return {
    action,
    duelId: receipt.duel.id,
    mode: 'direct',
    participantLabels: {
      creator: receipt.participants.creator.display,
      opponent: receipt.participants.opponent.display,
    },
    tier: moneyValue(receipt.pack.tier),
  };
}

function moneyValue(money: PublicDuelReceipt['pack']['tier']): number {
  return Number(money.amount) / 10 ** money.decimals;
}
