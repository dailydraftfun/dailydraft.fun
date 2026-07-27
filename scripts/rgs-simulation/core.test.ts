import { describe, expect, test } from 'bun:test';

import {
  fixtureSnapshotInput,
  prepareGachaInventorySnapshot,
} from '../../apps/api/src/gacha/gacha-inventory-snapshot.service.js';
import { createFixtureGachaPullOddsRuleSet } from '../../apps/api/src/gacha/gacha-pull-odds.js';
import { selectGachaOutcome } from '../../apps/api/src/gacha/gacha-rip.service.js';
import {
  sportsPackGachaFixtureCards,
  sportsPackGachaFixtureMachines,
} from '../../apps/api/src/gacha/sports-pack-gacha.fixture.js';
import { hashRgsText } from '../../packages/contracts/src/rgs.js';
import { simulateRgsMathConfig } from '../../packages/rgs-simulator/src/index.js';
import {
  createSportsPackGachaSimulationConfig,
  DEFAULT_RGS_SIMULATION_REPORT_PATH,
  parseRgsSimulationCliConfiguration,
  safeRgsSimulationOutputPath,
} from './core.js';

describe('RGS simulation CLI contract', () => {
  test('accepts bounded deterministic controls without accepting an external target', () => {
    expect(
      parseRgsSimulationCliConfiguration([
        '--rounds',
        '250000',
        '--seed',
        'fixture-seed',
        '--report',
        'artifacts/rgs.json',
      ]),
    ).toEqual({
      check: false,
      reportPath: 'artifacts/rgs.json',
      rounds: 250_000,
      seed: 'fixture-seed',
    });
    expect(parseRgsSimulationCliConfiguration(['--check']).reportPath).toBe(
      DEFAULT_RGS_SIMULATION_REPORT_PATH,
    );
    expect(() => parseRgsSimulationCliConfiguration(['--api-url', 'https://example.test'])).toThrow(
      'Unsupported argument',
    );
    expect(() => parseRgsSimulationCliConfiguration(['--rounds', '10000001'])).toThrow(
      'between 1 and 10000000',
    );
    expect(() => parseRgsSimulationCliConfiguration(['--seed', ' bad '])).toThrow(
      'canonical characters',
    );
  });

  test('builds the Gacha regression config from the provider fixture and committed odds', () => {
    const config = createSportsPackGachaSimulationConfig();
    const machine = sportsPackGachaFixtureMachines[0];
    if (!machine) throw new Error('Sports Pack Gacha fixture has no machine');
    const snapshot = prepareGachaInventorySnapshot(
      fixtureSnapshotInput(machine, sportsPackGachaFixtureCards(machine)),
    );
    const rules = createFixtureGachaPullOddsRuleSet(snapshot.contentHash);

    expect(config.activation).toBe('fixture-only');
    expect(config.realValueGate).toBe('hitl-required');
    expect(config.stakeMinor).toBe('50000000');
    expect(config.tiers.map(({ key, probabilityPpm }) => [key, probabilityPpm])).toEqual([
      ['base', 620_000],
      ['plus', 250_000],
      ['premium', 100_000],
      ['chase', 30_000],
    ]);
    expect(config.tiers.map((tier) => tier.payouts[0]?.payoutMinor)).toEqual([
      '35000000',
      '75000000',
      '150000000',
      '350000000',
    ]);
    expect(config.configHash).toBe(snapshot.contentHash);
    expect(config.rulesHash).toBe(rules.rulesHash);
    expect(config.mathConfigHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('replays canonical runtime selection for deterministic round seeds', () => {
    const config = createSportsPackGachaSimulationConfig();
    const machine = sportsPackGachaFixtureMachines[0];
    if (!machine) throw new Error('Sports Pack Gacha fixture has no machine');
    const snapshot = prepareGachaInventorySnapshot(
      fixtureSnapshotInput(machine, sportsPackGachaFixtureCards(machine)),
    );
    const rules = createFixtureGachaPullOddsRuleSet(snapshot.contentHash);
    const runtimeEntries = snapshot.entries.map((entry) => ({
      assetReference: entry.assetReference,
      eligible: entry.eligible,
      insuredValueMinor: entry.insuredValue?.amount ?? null,
    }));

    for (let round = 0; round < 32; round += 1) {
      const seed = `dailydraft.runtime-parity.${round}`;
      const report = simulateRgsMathConfig(config, { rounds: 1, seed });
      const runtime = selectGachaOutcome(runtimeEntries, rules, {
        clientSeed: hashRgsText(`${seed}:client:0`),
        serverSeed: hashRgsText(`${seed}:server:0`),
      });

      expect(report.realized.maxExposure.outcomeIds).toEqual([runtime.assetReference]);
      expect(report.realized.maxExposure.payoutMinor).toBe(runtime.insuredValueMinor);
    }
  });

  test('bounds report output to local evidence or artifacts directories', () => {
    expect(safeRgsSimulationOutputPath('evidence/rgs-simulation/report.json')).toBe(
      'evidence/rgs-simulation/report.json',
    );
    expect(() => safeRgsSimulationOutputPath('../report.json')).toThrow('under artifacts');
    expect(() => safeRgsSimulationOutputPath('evidence/report.txt')).toThrow('under artifacts');
  });
});
