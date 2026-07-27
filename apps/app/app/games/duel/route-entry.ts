import { fetchPublicDuelReceipt, type PublicDuelReceipt } from '../../duel/public-proof-client';
import type { DuelLobbyEntry } from '../../duel-arena';
import { buildSharedDuelEntry } from '../../overview/shared-route-entry';

export type DuelRouteSearchParams = {
  challenge?: string | string[];
  rematch?: string | string[];
};

type DuelReceiptLoader = (duelId: string) => Promise<PublicDuelReceipt | null>;

export async function resolveDuelRouteEntry(
  query: DuelRouteSearchParams,
  loadReceipt: DuelReceiptLoader = fetchPublicDuelReceipt,
): Promise<DuelLobbyEntry | null> {
  const challengeId = firstQueryValue(query.challenge);
  const rematchId = firstQueryValue(query.rematch);

  if (challengeId) {
    const receipt = await loadReceipt(challengeId);
    const entry = receipt ? buildSharedDuelEntry(receipt, 'accept') : null;
    if (entry) return entry;
  }

  if (rematchId) {
    const receipt = await loadReceipt(rematchId);
    const entry = receipt ? buildSharedDuelEntry(receipt, 'rematch') : null;
    if (entry) return entry;
  }

  return null;
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
