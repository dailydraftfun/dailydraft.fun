import { getDuelSocialSnapshot } from '../duel/social-card-data';
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
    const snapshot = getDuelSocialSnapshot(challengeId, 'waiting');
    return (
      <DuelArena
        key={`accept:${challengeId}`}
        entry={{
          action: 'accept',
          duelId: challengeId,
          mode: 'direct',
          opponentAddress: snapshot.playerAddress,
          opponentLabel: snapshot.player,
          tier: snapshot.tier,
        }}
      />
    );
  }

  if (rematchId) {
    const snapshot = getDuelSocialSnapshot(rematchId, 'settled');
    return (
      <DuelArena
        key={`rematch:${rematchId}`}
        entry={{
          action: 'rematch',
          duelId: rematchId,
          mode: snapshot.opponentType === 'house' ? 'house' : 'direct',
          opponentAddress:
            snapshot.opponentType === 'wallet' ? snapshot.opponentAddress : undefined,
          opponentLabel: snapshot.opponent,
          tier: snapshot.tier,
        }}
      />
    );
  }

  return <DuelArena />;
}
