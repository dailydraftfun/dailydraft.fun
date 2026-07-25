import { afterEach, describe, expect, test } from 'bun:test';

import {
  FixtureSportsPackGachaProvider,
  gachaFixtureModeEnabled,
} from './sports-pack-gacha.fixture.js';

const ORIGINAL_ENV = {
  fixture: process.env.DAILYDRAFT_GACHA_FIXTURE_MODE,
  node: process.env.NODE_ENV,
  vercel: process.env.VERCEL_ENV,
};

afterEach(() => {
  restoreEnvironment('DAILYDRAFT_GACHA_FIXTURE_MODE', ORIGINAL_ENV.fixture);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENV.node);
  restoreEnvironment('VERCEL_ENV', ORIGINAL_ENV.vercel);
});

describe('Sports Pack Gacha fixture provider', () => {
  test('returns the twelve deterministic devnet machines only with an explicit gate', async () => {
    const provider = new FixtureSportsPackGachaProvider();
    process.env.NODE_ENV = 'test';
    delete process.env.DAILYDRAFT_GACHA_FIXTURE_MODE;

    await expect(provider.listMachines()).rejects.toThrow(
      'disabled outside explicit fixture or preview mode',
    );

    process.env.DAILYDRAFT_GACHA_FIXTURE_MODE = 'true';
    const machines = await provider.listMachines();
    const replay = await provider.listMachines();
    const machine = machines[0];
    expect(machine).toBeDefined();
    if (!machine) throw new Error('Expected a fixture machine');
    const cards = await provider.getEligibleCards(machine.machineKey);
    const acquired = await provider.acquireCard({
      assetReference: cards[0]?.assetReference ?? '',
      recipientWallet: 'devnet-fixture-recipient',
      ripId: 'gacharip_fixture',
    });
    const settled = await provider.settleRip({
      acquisitionReference: acquired.acquisitionReference,
      ripId: 'gacharip_fixture',
    });

    expect(machines).toHaveLength(12);
    expect(replay).toEqual(machines);
    expect(machines.every((machine) => machine.machineKey.includes('devnet-fixture'))).toBe(true);
    expect(cards).toHaveLength(4);
    expect(cards.every((card) => card.assetReference?.includes('devnet:fixture:'))).toBe(true);
    expect(acquired).toMatchObject({ status: 'acquired' });
    expect(settled).toMatchObject({ status: 'settled' });
  });

  test('rejects unknown fixture machines', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DAILYDRAFT_GACHA_FIXTURE_MODE = 'true';
    delete process.env.VERCEL_ENV;

    await expect(
      new FixtureSportsPackGachaProvider().getEligibleCards('missing-machine'),
    ).rejects.toThrow('Gacha fixture machine was not found');
  });

  test('never enables fixtures in production and permits explicit test, dev, or preview use', () => {
    expect(
      gachaFixtureModeEnabled({
        NODE_ENV: 'production',
        DAILYDRAFT_GACHA_FIXTURE_MODE: 'true',
        VERCEL_ENV: 'production',
      }),
    ).toBe(false);
    expect(
      gachaFixtureModeEnabled({
        NODE_ENV: 'production',
        DAILYDRAFT_GACHA_FIXTURE_MODE: 'true',
        VERCEL_ENV: 'preview',
      }),
    ).toBe(true);
    expect(
      gachaFixtureModeEnabled({
        NODE_ENV: 'test',
        DAILYDRAFT_GACHA_FIXTURE_MODE: 'true',
      }),
    ).toBe(true);
    expect(
      gachaFixtureModeEnabled({
        NODE_ENV: 'development',
        DAILYDRAFT_GACHA_FIXTURE_MODE: 'true',
      }),
    ).toBe(true);
  });
});

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
