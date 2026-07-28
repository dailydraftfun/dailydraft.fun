import type { VerifiedGameActivity } from '@dailydraft/contracts/game-lobby';
import {
  PUBLIC_GAME_TAXONOMY_BY_ID,
  type PublicGameTaxonomyEntry,
} from '@dailydraft/contracts/public-game-taxonomy';

export type ActivityGrowthLinks = {
  discoverHref: PublicGameTaxonomyEntry['canonicalHref'];
  discoverLabel: string;
  profileHref: '/leaderboard';
  receiptHref: VerifiedGameActivity['receiptHref'];
  referralCode: `act_${string}`;
  resultHref: VerifiedGameActivity['resultHref'] | null;
  rematchHref: `/games/duel?rematch=${string}` | null;
  sharePath: `/games/activity?ref=${string}`;
};

export function buildActivityGrowthLinks(activity: VerifiedGameActivity): ActivityGrowthLinks {
  const mode = PUBLIC_GAME_TAXONOMY_BY_ID[activity.mode];
  const roundId = activity.activityId.slice(activity.mode.length + 1);
  const referralCode = opaqueActivityReference(activity.activityId);

  return {
    discoverHref: mode.canonicalHref,
    discoverLabel: `Explore ${mode.name}`,
    profileHref: '/leaderboard',
    receiptHref: activity.receiptHref,
    referralCode,
    resultHref: activity.resultHref === activity.receiptHref ? null : activity.resultHref,
    rematchHref:
      activity.mode === 'duel' ? `/games/duel?rematch=${encodeURIComponent(roundId)}` : null,
    sharePath: `/games/activity?ref=${referralCode}`,
  };
}

export function activityShareText(activity: VerifiedGameActivity): string {
  const mode = PUBLIC_GAME_TAXONOMY_BY_ID[activity.mode];
  return `${mode.name} settled on DailyDraft devnet. Inspect the public proof—no wallet or participant details are included in this share.`;
}

export function opaqueActivityReference(
  activityId: VerifiedGameActivity['activityId'],
): `act_${string}` {
  let hash = 0x811c9dc5;
  for (const character of activityId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `act_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
