import { describe, expect, test } from 'bun:test';

import { GachaController } from './gacha.controller.js';
import type { GachaInventorySnapshotService } from './gacha-inventory-snapshot.service.js';
import type { GachaRipService } from './gacha-rip.service.js';

describe('GachaController', () => {
  test('routes inspectable commitments and fixture rip actions to their services', async () => {
    const calls: string[] = [];
    const snapshots = {
      findLatestSealed: async (machineKey: string) => {
        calls.push(`inventory:${machineKey}`);
        return { contentHash: 'a'.repeat(64) };
      },
    } as unknown as GachaInventorySnapshotService;
    const rips = {
      capability: () => {
        calls.push('capability');
        return { availability: 'preview' };
      },
      createFixtureRip: async (input: { machineKey: string }) => {
        calls.push(`rip:${input.machineKey}`);
        return { status: 'SETTLED' };
      },
      findCommittedOdds: async (machineKey: string) => {
        calls.push(`odds:${machineKey}`);
        return { rulesHash: 'b'.repeat(64) };
      },
    } as unknown as GachaRipService;
    const controller = new GachaController(snapshots, rips);
    const params = { machineKey: 'fixture-machine' };
    const ripInput = {
      machineKey: 'fixture-machine',
      oddsVersion: 1,
      recipientWallet: 'devnet-fixture-recipient',
      seed: 'fixture-seed-0000000001',
    };

    expect(controller.capability()).toEqual({ availability: 'preview' });
    await expect(controller.findInventory(params)).resolves.toEqual({
      contentHash: 'a'.repeat(64),
    });
    await expect(controller.findOdds(params)).resolves.toEqual({ rulesHash: 'b'.repeat(64) });
    await expect(controller.createFixtureRip(ripInput)).resolves.toEqual({ status: 'SETTLED' });
    expect(calls).toEqual([
      'capability',
      'inventory:fixture-machine',
      'odds:fixture-machine',
      'rip:fixture-machine',
    ]);
  });
});
