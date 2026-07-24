import { describe, expect, test } from 'bun:test';
import { ServiceUnavailableException } from '@nestjs/common';

import { CollectorCryptSportsPackGachaProvider } from './sports-pack-gacha.provider.js';

describe('CollectorCryptSportsPackGachaProvider', () => {
  test('keeps every unconfirmed partner operation fail-closed', async () => {
    const provider = new CollectorCryptSportsPackGachaProvider();
    const operations = [
      () => provider.listMachines(),
      () => provider.getEligibleCards('collector-crypt-football-50000000'),
      () =>
        provider.acquireCard({
          assetReference: 'asset_01',
          recipientWallet: 'wallet_01',
          ripId: 'gacharip_01',
        }),
      () =>
        provider.settleRip({
          acquisitionReference: 'acquisition_01',
          ripId: 'gacharip_01',
        }),
    ];

    for (const operation of operations) {
      const result = operation();
      await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(result).rejects.toThrow(
        'Sports Pack Gacha operations are disabled until the Collector Crypt partner API contract is confirmed',
      );
    }
  });
});
