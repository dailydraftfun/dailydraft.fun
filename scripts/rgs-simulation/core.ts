import {
  fixtureSnapshotInput,
  prepareGachaInventorySnapshot,
} from '../../apps/api/src/gacha/gacha-inventory-snapshot.service.js';
import {
  createFixtureGachaPullOddsRuleSet,
  gachaPullOddsBandForValue,
} from '../../apps/api/src/gacha/gacha-pull-odds.js';
import {
  sportsPackGachaFixtureCards,
  sportsPackGachaFixtureMachines,
} from '../../apps/api/src/gacha/sports-pack-gacha.fixture.js';
import {
  createRgsSimulationConfig,
  RGS_SIMULATION_CONFIG_SCHEMA_VERSION,
  RGS_SIMULATION_PROBABILITY_SCALE_PPM,
  RGS_SIMULATOR_VERSION,
  type RgsSimulationConfig,
} from '../../packages/rgs-simulator/src/index.js';

export const DEFAULT_RGS_SIMULATION_ROUNDS = 100_000;
export const DEFAULT_RGS_SIMULATION_SEED = 'dailydraft.gacha-sports-pack-fixture-simulation.v1';
export const DEFAULT_RGS_SIMULATION_REPORT_PATH =
  'evidence/rgs-simulation/gacha-sports-pack-fixture-v1.json';
export const DEFAULT_RGS_SIMULATION_MANIFEST_PATH = 'evidence/rgs-simulation/manifest.v1.json';

export interface RgsSimulationCliConfiguration {
  check: boolean;
  reportPath?: string;
  rounds: number;
  seed: string;
}

export function parseRgsSimulationCliConfiguration(
  arguments_: readonly string[],
): RgsSimulationCliConfiguration {
  const configuration: RgsSimulationCliConfiguration = {
    check: false,
    rounds: DEFAULT_RGS_SIMULATION_ROUNDS,
    seed: DEFAULT_RGS_SIMULATION_SEED,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    if (flag === '--check') {
      configuration.check = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case '--report':
        configuration.reportPath = safeRgsSimulationOutputPath(value);
        break;
      case '--rounds':
        configuration.rounds = boundedInteger(value, '--rounds', 1, 10_000_000);
        break;
      case '--seed':
        configuration.seed = canonicalSeed(value);
        break;
      default:
        throw new Error(`Unsupported argument: ${flag}`);
    }
    index += 1;
  }
  if (configuration.check && configuration.reportPath === undefined) {
    configuration.reportPath = DEFAULT_RGS_SIMULATION_REPORT_PATH;
  }
  return configuration;
}

export function createSportsPackGachaSimulationConfig(): RgsSimulationConfig {
  const machine = sportsPackGachaFixtureMachines[0];
  if (!machine) throw new Error('Sports Pack Gacha simulation fixture has no machine');
  const cards = sportsPackGachaFixtureCards(machine);
  const snapshot = prepareGachaInventorySnapshot(fixtureSnapshotInput(machine, cards));
  const rules = createFixtureGachaPullOddsRuleSet(snapshot.contentHash);
  const tiers = rules.bands.map((band) => ({
    key: band.label,
    payouts: snapshot.entries
      .filter(
        (entry) =>
          entry.eligible &&
          entry.insuredValue &&
          gachaPullOddsBandForValue(rules.bands, entry.insuredValue.amount).label === band.label,
      )
      .map((entry) => {
        if (!entry.assetReference || !entry.insuredValue) {
          throw new Error('Sports Pack Gacha simulation fixture card is incomplete');
        }
        return {
          id: entry.assetReference,
          payoutMinor: entry.insuredValue.amount,
        };
      }),
    probabilityPpm: band.probabilityPpm,
  }));

  return createRgsSimulationConfig({
    activation: rules.activation,
    configHash: snapshot.contentHash,
    currency: rules.currency,
    decimals: rules.decimals,
    mode: 'gacha',
    probabilityScalePpm: RGS_SIMULATION_PROBABILITY_SCALE_PPM,
    realValueGate: 'hitl-required',
    rulesHash: rules.rulesHash,
    schemaVersion: RGS_SIMULATION_CONFIG_SCHEMA_VERSION,
    simulationKey: DEFAULT_RGS_SIMULATION_SEED,
    simulatorVersion: RGS_SIMULATOR_VERSION,
    stakeMinor: machine.tierPriceMinor,
    tiers,
    tolerances: {
      hitRateAbsolutePpm: 10_000,
      rtpRelativePpm: 30_000,
      varianceRelativePpm: 50_000,
    },
  });
}

export function safeRgsSimulationOutputPath(value: string): string {
  const validPrefix =
    value.startsWith('artifacts/') || value.startsWith('evidence/rgs-simulation/');
  if (!validPrefix || value.includes('..') || !value.endsWith('.json')) {
    throw new Error('--report must be a JSON file under artifacts/ or evidence/rgs-simulation/');
  }
  return value;
}

function boundedInteger(value: string, flag: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function canonicalSeed(value: string): string {
  if (
    value.length === 0 ||
    value.length > 240 ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new Error('--seed must contain 1-240 canonical characters');
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}
