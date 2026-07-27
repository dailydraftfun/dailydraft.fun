import { describe, expect, test } from 'bun:test';

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
    expect(config.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(config.rulesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(config.mathConfigHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('bounds report output to local evidence or artifacts directories', () => {
    expect(safeRgsSimulationOutputPath('evidence/rgs-simulation/report.json')).toBe(
      'evidence/rgs-simulation/report.json',
    );
    expect(() => safeRgsSimulationOutputPath('../report.json')).toThrow('under artifacts');
    expect(() => safeRgsSimulationOutputPath('evidence/report.txt')).toThrow('under artifacts');
  });
});
