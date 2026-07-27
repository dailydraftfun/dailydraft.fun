import { describe, expect, test } from 'bun:test';

import {
  createRgsSimulationConfig,
  createRgsSimulationEvidenceEntry,
  createRgsSimulationEvidenceManifest,
  evaluateRgsSimulationPromotion,
  RGS_SIMULATION_CONFIG_SCHEMA_VERSION,
  RGS_SIMULATION_PROBABILITY_SCALE_PPM,
  RGS_SIMULATOR_VERSION,
  type RgsSimulationConfig,
  simulateRgsMathConfig,
  type UnsignedRgsSimulationConfig,
  validateRgsSimulationConfig,
  verifyRgsSimulationReport,
} from './index.js';

const RUN = {
  rounds: 100_000,
  seed: 'dailydraft.gacha-sports-pack-fixture-simulation.v1',
} as const;

describe('RGS math simulator', () => {
  test('replays the same config and seed byte-for-byte with passing Gacha metrics', () => {
    const config = fixtureConfig();
    const first = simulateRgsMathConfig(config, RUN);
    const replay = simulateRgsMathConfig(config, RUN);

    expect(replay).toEqual(first);
    expect(first.passed).toBe(true);
    expect(first.run.rounds).toBe(100_000);
    expect(first.declared.tiers.map(({ hitRatePpm, key }) => [key, hitRatePpm])).toEqual([
      ['base', 620_000],
      ['plus', 250_000],
      ['premium', 100_000],
      ['chase', 30_000],
    ]);
    expect(first.declared.rtpPpm).toBe('1319000');
    expect(first.declared.maxExposure).toMatchObject({
      netExposureMinor: '300000000',
      outcomeIds: ['fixture-chase'],
      payoutMinor: '350000000',
    });
    expect(first.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyRgsSimulationReport(config, first)).toEqual({ errors: [], valid: true });
  });

  test('changes deterministic evidence when the seed changes', () => {
    const config = fixtureConfig();
    const first = simulateRgsMathConfig(config, RUN);
    const second = simulateRgsMathConfig(config, { ...RUN, seed: `${RUN.seed}:alternate` });

    expect(second.reportHash).not.toBe(first.reportHash);
    expect(second.realized).not.toEqual(first.realized);
    expect(verifyRgsSimulationReport(config, second).valid).toBe(true);
  });

  test('detects report tampering and incompatible report versions', () => {
    const config = fixtureConfig();
    const report = simulateRgsMathConfig(config, RUN);
    const tampered = {
      ...report,
      realized: { ...report.realized, rtpPpm: '999999999' },
    };
    const driftedVersion = { ...report, simulatorVersion: 'dailydraft.rgs-simulator.v2' };

    expect(verifyRgsSimulationReport(config, tampered)).toMatchObject({
      errors: expect.arrayContaining([
        'reportHash mismatch',
        'report does not reproduce from its config, seed, and round count',
      ]),
      valid: false,
    });
    expect(verifyRgsSimulationReport(config, driftedVersion)).toMatchObject({
      errors: expect.arrayContaining(['unsupported simulatorVersion']),
      valid: false,
    });
    expect(verifyRgsSimulationReport(config, null).valid).toBe(false);
  });

  test('fails malformed, uncommitted, or economically ambiguous configs closed', () => {
    const unsigned = unsignedFixtureConfig();
    const cases: Array<[unknown, string]> = [
      [{ ...unsigned, schemaVersion: 'dailydraft.rgs-simulation-config.v2' }, 'schemaVersion'],
      [{ ...unsigned, activation: 'mainnet' }, 'activation'],
      [{ ...unsigned, realValueGate: 'approved' }, 'hitl-required'],
      [{ ...unsigned, configHash: 'invalid' }, 'configHash'],
      [{ ...unsigned, rulesHash: 'invalid' }, 'rulesHash'],
      [{ ...unsigned, probabilityScalePpm: 100 }, 'probabilityScalePpm'],
      [{ ...unsigned, stakeMinor: '0' }, 'stakeMinor'],
      [{ ...unsigned, tiers: [] }, 'tiers'],
      [
        {
          ...unsigned,
          tiers: unsigned.tiers.map((tier) =>
            tier.key === 'base' ? { ...tier, probabilityPpm: 619_999 } : tier,
          ),
        },
        'must total',
      ],
      [
        {
          ...unsigned,
          tiers: [
            unsigned.tiers[0],
            { ...unsigned.tiers[1], key: unsigned.tiers[0]?.key ?? '' },
            ...unsigned.tiers.slice(2),
          ],
        },
        'duplicated',
      ],
    ];

    for (const [candidate, message] of cases) {
      expect(() => createRgsSimulationConfig(candidate as UnsignedRgsSimulationConfig)).toThrow(
        message,
      );
    }

    const config = fixtureConfig();
    expect(() =>
      validateRgsSimulationConfig({ ...config, mathConfigHash: 'f'.repeat(64) }),
    ).toThrow('does not match');
    expect(() => simulateRgsMathConfig(config, { rounds: 0, seed: RUN.seed })).toThrow('rounds');
    expect(() => simulateRgsMathConfig(config, { rounds: 1, seed: ' bad ' })).toThrow('seed');
  });

  test('requires reproducible checked-in evidence but never authorizes promotion', () => {
    const config = fixtureConfig();
    const report = simulateRgsMathConfig(config, RUN);
    const passing = evaluateRgsSimulationPromotion(config, report, 'devnet');
    const absent = evaluateRgsSimulationPromotion(config, null, 'devnet');
    const tooSmall = evaluateRgsSimulationPromotion(
      config,
      simulateRgsMathConfig(config, { rounds: 10_000, seed: RUN.seed }),
      'devnet',
    );

    expect(passing).toEqual({
      errors: [],
      promotionAuthorized: false,
      realValueGate: 'hitl-required',
      simulationGatePassed: true,
      targetActivation: 'devnet',
    });
    expect(absent).toMatchObject({
      promotionAuthorized: false,
      realValueGate: 'hitl-required',
      simulationGatePassed: false,
    });
    expect(tooSmall.errors).toContain('simulation report requires at least 100000 rounds');
  });

  test('binds manifest evidence to an exact safe path, report, and minimum round count', () => {
    const config = fixtureConfig();
    const report = simulateRgsMathConfig(config, RUN);
    const entry = createRgsSimulationEvidenceEntry({
      config,
      report,
      reportPath: 'evidence/rgs-simulation/gacha-sports-pack-fixture-v1.json',
    });
    const manifest = createRgsSimulationEvidenceManifest([entry]);

    expect(manifest.entries[0]).toMatchObject({
      configHash: config.configHash,
      mathConfigHash: config.mathConfigHash,
      minimumRounds: 100_000,
      reportHash: report.reportHash,
      rulesHash: config.rulesHash,
    });
    expect(() =>
      createRgsSimulationEvidenceEntry({
        config,
        report,
        reportPath: '../report.json',
      }),
    ).toThrow('evidence/rgs-simulation');
    expect(() => createRgsSimulationEvidenceManifest([entry, entry])).toThrow('duplicated');
    expect(() =>
      createRgsSimulationEvidenceEntry({
        config,
        minimumRounds: 100_001,
        report,
        reportPath: entry.reportPath,
      }),
    ).toThrow('required');
  });
});

function fixtureConfig(): RgsSimulationConfig {
  return createRgsSimulationConfig(unsignedFixtureConfig());
}

function unsignedFixtureConfig(): UnsignedRgsSimulationConfig {
  return {
    activation: 'fixture-only',
    configHash: 'a'.repeat(64),
    currency: 'USDC',
    decimals: 6,
    mode: 'gacha',
    probabilityScalePpm: RGS_SIMULATION_PROBABILITY_SCALE_PPM,
    realValueGate: 'hitl-required',
    rulesHash: 'b'.repeat(64),
    schemaVersion: RGS_SIMULATION_CONFIG_SCHEMA_VERSION,
    simulationKey: 'dailydraft.gacha-sports-pack-fixture-simulation.v1',
    simulatorVersion: RGS_SIMULATOR_VERSION,
    stakeMinor: '50000000',
    tiers: [
      {
        key: 'base',
        payouts: [{ id: 'fixture-base', payoutMinor: '35000000' }],
        probabilityPpm: 620_000,
      },
      {
        key: 'plus',
        payouts: [{ id: 'fixture-plus', payoutMinor: '75000000' }],
        probabilityPpm: 250_000,
      },
      {
        key: 'premium',
        payouts: [{ id: 'fixture-premium', payoutMinor: '150000000' }],
        probabilityPpm: 100_000,
      },
      {
        key: 'chase',
        payouts: [{ id: 'fixture-chase', payoutMinor: '350000000' }],
        probabilityPpm: 30_000,
      },
    ],
    tolerances: {
      hitRateAbsolutePpm: 10_000,
      rtpRelativePpm: 30_000,
      varianceRelativePpm: 50_000,
    },
  };
}
