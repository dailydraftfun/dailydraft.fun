import { fetchPublicDuelReceipt, type PublicDuelReceipt } from '../duel/public-proof-client';
import { DuelArena } from '../duel-arena';

type OverviewPageProps = {
  searchParams: Promise<{
    challenge?: string | string[];
    rematch?: string | string[];
  }>;
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const query = await searchParams;
  const challengeId = firstQueryValue(query.challenge);
  const rematchId = firstQueryValue(query.rematch);

  if (challengeId) {
    const receipt = await fetchPublicDuelReceipt(challengeId);
    if (receipt?.duel.status === 'waiting' && receipt.duel.mode === 'direct') {
      return (
        <DuelArena
          key={`accept:${challengeId}`}
          entry={{
            action: 'accept',
            duelId: receipt.duel.id,
            mode: 'direct',
            opponentAddress: receipt.participants.creator.address,
            opponentLabel: receipt.participants.creator.display,
            tier: moneyValue(receipt.pack.tier),
          }}
        />
      );
    }
  }

  if (rematchId) {
    const receipt = await fetchPublicDuelReceipt(rematchId);
    if (
      receipt?.duel.status === 'settled' &&
      receipt.duel.mode !== 'house' &&
      receipt.participants.opponent
    ) {
      return (
        <DuelArena
          key={`rematch:${rematchId}`}
          entry={{
            action: 'rematch',
            duelId: receipt.duel.id,
            mode: 'direct',
            opponentAddress: receipt.participants.opponent.address,
            opponentLabel: receipt.participants.opponent.display,
            tier: moneyValue(receipt.pack.tier),
          }}
        />
      );
    }
  }

  return <DuelArena />;
}

function moneyValue(money: PublicDuelReceipt['pack']['tier']): number {
  return Number(money.amount) / 10 ** money.decimals;
}
