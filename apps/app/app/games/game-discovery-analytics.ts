'use client';

import type { VerifiedGameActivity } from '@dailydraft/contracts/game-lobby';
import type { PublicGameTaxonomyId } from '@dailydraft/contracts/public-game-taxonomy';

import { opaqueActivityReference } from './activity-growth';

export const GAME_DISCOVERY_EVENT_NAME = 'dailydraft:game-discovery' as const;

export type GameDiscoveryStage =
  | 'hub-view'
  | 'mode-detail'
  | 'mode-discovery'
  | 'play-or-preview'
  | 'profile-view'
  | 'referral-share'
  | 'rematch'
  | 'result-view'
  | 'wallet-gate';

export type GameDiscoveryEvent = {
  actionId?: string;
  activityRef?: `act_${string}`;
  mode?: PublicGameTaxonomyId;
  schemaVersion: 'dailydraft.game-discovery.v1';
  stage: GameDiscoveryStage;
};

export function buildGameDiscoveryEvent(input: {
  actionId?: string;
  activityId?: VerifiedGameActivity['activityId'];
  mode?: PublicGameTaxonomyId;
  stage: GameDiscoveryStage;
}): GameDiscoveryEvent {
  const actionId = boundedActionId(input.actionId);
  return {
    ...(actionId ? { actionId } : {}),
    ...(input.activityId ? { activityRef: opaqueActivityReference(input.activityId) } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    schemaVersion: 'dailydraft.game-discovery.v1',
    stage: input.stage,
  };
}

/* istanbul ignore next -- browser dispatch is exercised by the journey suite. */
export function trackGameDiscovery(input: Parameters<typeof buildGameDiscoveryEvent>[0]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<GameDiscoveryEvent>(GAME_DISCOVERY_EVENT_NAME, {
      detail: buildGameDiscoveryEvent(input),
    }),
  );
}

function boundedActionId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(normalized) ? normalized : 'invalid-action';
}
