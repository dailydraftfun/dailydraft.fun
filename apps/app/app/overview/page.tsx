import { fetchPublicDuelReceipt } from '../duel/public-proof-client';
import { DuelArena } from '../duel-arena';
import { buildSharedDuelEntry } from './shared-route-entry';

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
    const entry = receipt ? buildSharedDuelEntry(receipt, 'accept') : null;
    if (entry) return <DuelArena key={`accept:${challengeId}`} entry={entry} />;
  }

  if (rematchId) {
    const receipt = await fetchPublicDuelReceipt(rematchId);
    const entry = receipt ? buildSharedDuelEntry(receipt, 'rematch') : null;
    if (entry) return <DuelArena key={`rematch:${rematchId}`} entry={entry} />;
  }

  return <DuelArena />;
}
