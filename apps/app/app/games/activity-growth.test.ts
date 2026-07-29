import { describe, expect, test } from 'bun:test';
import { verifiedGameActivityContractFixtures } from '@dailydraft/contracts/game-lobby';

import {
  activityShareText,
  buildActivityGrowthLinks,
  opaqueActivityReference,
} from './activity-growth';

describe('verified activity growth links', () => {
  test('adds proof, profile discovery, rematch, referral, and mode discovery without wallets', () => {
    const activity = verifiedGameActivityContractFixtures.duel;
    const links = buildActivityGrowthLinks(activity);
    const serialized = JSON.stringify({ links, share: activityShareText(activity) });

    expect(links).toMatchObject({
      discoverHref: '/games/duel',
      discoverLabel: 'Explore Card Duel',
      profileHref: '/leaderboard',
      receiptHref: '/v1/duels/duel_activity000001/receipt',
      resultHref: '/v1/rgs/rounds/duel/duel_activity000001/proof',
      rematchHref: '/games/duel?rematch=duel_activity000001',
    });
    expect(links.referralCode).toMatch(/^act_[a-f0-9]{8}$/);
    expect(links.sharePath).toBe(`/games/activity?ref=${links.referralCode}`);
    expect(serialized).not.toContain('9xQe…9gJ1');
    expect(serialized).not.toContain('Gk8Z…MQyW');
  });

  test('deduplicates identical proof and receipt links and keeps non-Duel discovery canonical', () => {
    const activity = verifiedGameActivityContractFixtures.gacha;
    const links = buildActivityGrowthLinks(activity);

    expect(links.resultHref).toBeNull();
    expect(links.rematchHref).toBeNull();
    expect(links.discoverHref).toBe('/games/gacha');
    expect(links.discoverLabel).toBe('Explore Sports Pack Gacha');
  });

  test('creates deterministic opaque references without exposing the source identifier', () => {
    const first = opaqueActivityReference('duel:duel_activity000001');
    const second = opaqueActivityReference('duel:duel_activity000002');

    expect(first).toBe(opaqueActivityReference('duel:duel_activity000001'));
    expect(first).not.toBe(second);
    expect(first).not.toContain('duel');
  });
});
