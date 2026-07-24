import { describe, expect, test } from 'bun:test';
import { GachaRipStatus, GachaSport } from '@openpacksduel/db';

import { GachaController } from './gacha.controller.js';
import type { GachaInventorySnapshotService } from './gacha-inventory-snapshot.service.js';
import type { GachaRipService } from './gacha-rip.service.js';

describe('GachaController', () => {
  test('routes inspectable commitments and fixture rip actions to their services', async () => {
    const calls: string[] = [];
    const now = new Date('2026-07-24T12:00:00.000Z');
    const capability = {
      availability: 'preview',
      gates: {
        acquisition: false,
        odds: false,
        provider: false,
        settlement: false,
      },
      providerMode: 'collector-crypt',
      reason: 'Pending Gacha capability gates: provider, odds, acquisition, settlement',
    } satisfies ReturnType<GachaRipService['capability']>;
    const inventory = {
      committedPoolSize: 1,
      contentHash: 'a'.repeat(64),
      createdAt: now,
      eligibleCount: 1,
      eligibleValueMinor: '35000000',
      entries: [
        {
          assetReference: 'devnet:fixture:asset:base',
          displayName: 'Fixture Base Card',
          eligible: true,
          exclusionReasons: [],
          graded: true,
          graderReference: 'fixture-grader',
          id: 'gachaentry_fixture',
          insuredValueCurrency: 'USDC',
          insuredValueDecimals: 6,
          insuredValueMinor: '35000000',
          insuredValueProviderReference: 'fixture-value',
          inventorySourceTimestamp: now,
          ordinal: 0,
          poolOpen: true,
          providerCardReference: 'fixture-card',
          snapshotId: 'gachasnap_fixture',
          sport: GachaSport.FOOTBALL,
          tierEnabled: true,
          valuationSourceReference: 'fixture-valuation',
          valuationTimestamp: now,
          vaulted: true,
        },
      ],
      evaluatedAt: now,
      excludedCount: 0,
      id: 'gachasnap_fixture',
      machine: {
        active: false,
        committedPoolSize: 1,
        createdAt: now,
        displayName: 'Fixture Football Machine',
        id: 'gachamachine_fixture',
        machineKey: 'fixture-machine',
        sport: GachaSport.FOOTBALL,
        tierPriceCurrency: 'USDC',
        tierPriceDecimals: 6,
        tierPriceMinor: '50000000',
        updatedAt: now,
      },
      machineKey: 'fixture-machine',
      maximumEligibleItems: 1,
      maximumFutureSkewMs: 1_000,
      maximumSourceAgeMs: 60_000,
      policy: {},
      policyHash: 'c'.repeat(64),
      policyVersion: 'fixture-policy-v1',
      poolKey: 'fixture-machine:pool',
      provider: 'fixture',
      revision: 1,
      schemaVersion: 'openpacksduel.gacha-inventory.v1',
      sealedAt: now,
    } satisfies Awaited<ReturnType<GachaInventorySnapshotService['findLatestSealed']>>;
    const odds = {
      bandMinimums: {
        base: '0',
        chase: '250000000',
        plus: '50000000',
        premium: '100000000',
      },
      baseProbabilityPpm: 620_000,
      calculatorVersion: 'openpacksduel.gacha-pull-odds-calculator.v1',
      chaseProbabilityPpm: 30_000,
      committedAt: now,
      createdAt: now,
      id: 'gachaodds_fixture',
      machineKey: 'fixture-machine',
      oddsKey: 'fixture-machine:fixture-odds',
      plusProbabilityPpm: 250_000,
      premiumProbabilityPpm: 100_000,
      probabilityScalePpm: 1_000_000,
      rulesHash: 'b'.repeat(64),
      schemaVersion: 'openpacksduel.gacha-pull-odds.v1',
      sealedAt: now,
      snapshotContentHash: inventory.contentHash,
      version: 1,
    } satisfies NonNullable<Awaited<ReturnType<GachaRipService['findCommittedOdds']>>>;
    const seedCommitment = {
      commitmentId: 'gachaseed_fixture',
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      serverSeedHash: 'e'.repeat(64),
    } satisfies Awaited<ReturnType<GachaRipService['createSeedCommitment']>>;
    const ripResult = {
      oddsCommitment: {
        calculatorVersion: odds.calculatorVersion,
        committedAt: now,
        oddsKey: odds.oddsKey,
        rulesHash: odds.rulesHash,
        schemaVersion: odds.schemaVersion,
        snapshotContentHash: odds.snapshotContentHash,
        version: odds.version,
      },
      rip: {
        acquiredAt: now,
        acquisitionReference: 'devnet-acquisition-reference',
        createdAt: now,
        failedAt: null,
        failureReason: null,
        id: 'gacharip_fixture',
        idempotencyKey: 'idem-fixture-key',
        insuredValueCurrency: 'USDC',
        insuredValueDecimals: 6,
        insuredValueMinor: '35000000',
        machineKey: 'fixture-machine',
        oddsCommitmentId: odds.id,
        oddsRulesHash: odds.rulesHash,
        revealedAt: now,
        seedCommitmentHash: 'd'.repeat(64),
        selectedAssetReference: 'devnet:fixture:asset:base',
        selectedAt: now,
        settledAt: now,
        settlementReference: 'devnet-settlement-reference',
        snapshotContentHash: inventory.contentHash,
        status: GachaRipStatus.SETTLED,
        updatedAt: now,
      },
      serverSeed: 'f'.repeat(64),
      serverSeedHash: seedCommitment.serverSeedHash,
    } satisfies Awaited<ReturnType<GachaRipService['createFixtureRip']>>;
    const snapshots = {
      findLatestSealed: async (machineKey: string) => {
        calls.push(`inventory:${machineKey}`);
        return inventory;
      },
    } as unknown as GachaInventorySnapshotService;
    const rips = {
      capability: () => {
        calls.push('capability');
        return capability;
      },
      createFixtureRip: async (input: { idempotencyKey?: string; machineKey: string }) => {
        calls.push(`rip:${input.machineKey}:${input.idempotencyKey ?? 'none'}`);
        return ripResult;
      },
      createSeedCommitment: async (machineKey: string) => {
        calls.push(`rip-commitment:${machineKey}`);
        return seedCommitment;
      },
      findCommittedOdds: async (machineKey: string) => {
        calls.push(`odds:${machineKey}`);
        return odds;
      },
    } as unknown as GachaRipService;
    const controller = new GachaController(snapshots, rips);
    const params = { machineKey: 'fixture-machine' };
    const ripInput = {
      commitmentId: 'gachaseed_fixture',
      machineKey: 'fixture-machine',
      oddsVersion: 1,
      recipientWallet: 'devnet-fixture-recipient',
      seed: 'fixture-seed-0000000001',
    };

    expect(controller.capability()).toEqual(capability);
    await expect(controller.findInventory(params)).resolves.toEqual(inventory);
    await expect(controller.findOdds(params)).resolves.toEqual(odds);
    await expect(controller.createSeedCommitment(params)).resolves.toEqual(seedCommitment);
    await expect(
      controller.createFixtureRip({ ...ripInput, idempotencyKey: 'body-key' }, 'idem-fixture-key'),
    ).resolves.toEqual(ripResult);
    expect(calls).toEqual([
      'capability',
      'inventory:fixture-machine',
      'odds:fixture-machine',
      'rip-commitment:fixture-machine',
      'rip:fixture-machine:idem-fixture-key',
    ]);
  });

  test('falls back to the request body idempotency key when no header is provided', async () => {
    const calls: string[] = [];
    const rips = {
      createFixtureRip: async (input: { idempotencyKey?: string; machineKey: string }) => {
        calls.push(`rip:${input.machineKey}:${input.idempotencyKey ?? 'none'}`);
        return {} as Awaited<ReturnType<GachaRipService['createFixtureRip']>>;
      },
    } as unknown as GachaRipService;
    const controller = new GachaController({} as GachaInventorySnapshotService, rips);

    await controller.createFixtureRip(
      {
        commitmentId: 'gachaseed_fixture',
        idempotencyKey: 'body-key',
        machineKey: 'fixture-machine',
        oddsVersion: 1,
        recipientWallet: 'devnet-fixture-recipient',
        seed: 'fixture-seed-0000000001',
      },
      undefined,
    );

    expect(calls).toEqual(['rip:fixture-machine:body-key']);
  });
});
