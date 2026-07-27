import type { RgsMode, RgsModeActivation } from '@dailydraft/contracts/rgs';

export const RGS_SIMULATION_CONFIG_SCHEMA_VERSION = 'dailydraft.rgs-simulation-config.v1' as const;
export const RGS_SIMULATION_REPORT_SCHEMA_VERSION = 'dailydraft.rgs-simulation-report.v1' as const;
export const RGS_SIMULATION_MANIFEST_SCHEMA_VERSION =
  'dailydraft.rgs-simulation-manifest.v1' as const;
export const RGS_SIMULATOR_VERSION = 'dailydraft.rgs-simulator.v1' as const;
export const RGS_SIMULATION_PROBABILITY_SCALE_PPM = 1_000_000 as const;
export const RGS_SIMULATION_MINIMUM_PROMOTION_ROUNDS = 100_000;

export interface RgsSimulationPayout {
  id: string;
  payoutMinor: string;
}

export interface RgsSimulationTier {
  key: string;
  payouts: readonly RgsSimulationPayout[];
  probabilityPpm: number;
}

export interface RgsSimulationTolerances {
  hitRateAbsolutePpm: number;
  rtpRelativePpm: number;
  varianceRelativePpm: number;
}

export interface UnsignedRgsSimulationConfig {
  activation: RgsModeActivation;
  configHash: string;
  currency: string;
  decimals: number;
  mode: RgsMode;
  probabilityScalePpm: typeof RGS_SIMULATION_PROBABILITY_SCALE_PPM;
  realValueGate: 'hitl-required';
  rulesHash: string;
  schemaVersion: typeof RGS_SIMULATION_CONFIG_SCHEMA_VERSION;
  simulationKey: string;
  simulatorVersion: typeof RGS_SIMULATOR_VERSION;
  stakeMinor: string;
  tiers: readonly RgsSimulationTier[];
  tolerances: RgsSimulationTolerances;
}

export interface RgsSimulationConfig extends UnsignedRgsSimulationConfig {
  mathConfigHash: string;
}

export interface RgsSimulationRun {
  rounds: number;
  seed: string;
}

export interface RgsSimulationDeclaredTierMetric {
  hitRatePpm: number;
  key: string;
}

export interface RgsSimulationRealizedTierMetric extends RgsSimulationDeclaredTierMetric {
  hits: number;
}

export interface RgsSimulationDeclaredMaxExposure {
  hitRatePpm: number;
  netExposureMinor: string;
  outcomeIds: readonly string[];
  payoutMinor: string;
}

export interface RgsSimulationRealizedMaxExposure extends RgsSimulationDeclaredMaxExposure {
  hits: number;
}

export interface RgsSimulationDeclaredMetrics {
  maxExposure: RgsSimulationDeclaredMaxExposure;
  payoutVariancePpmSquared: string;
  rtpPpm: string;
  tiers: readonly RgsSimulationDeclaredTierMetric[];
}

export interface RgsSimulationRealizedMetrics {
  maxExposure: RgsSimulationRealizedMaxExposure;
  payoutVariancePpmSquared: string;
  rtpPpm: string;
  tiers: readonly RgsSimulationRealizedTierMetric[];
}

export interface RgsSimulationCheck {
  declared: string;
  name: string;
  passed: boolean;
  realized: string;
  tolerance: string;
}

export interface RgsSimulationReportConfig {
  activation: RgsModeActivation;
  configHash: string;
  currency: string;
  decimals: number;
  mathConfigHash: string;
  mode: RgsMode;
  realValueGate: 'hitl-required';
  rulesHash: string;
  simulationKey: string;
  stakeMinor: string;
}

export interface UnsignedRgsSimulationReport {
  checks: readonly RgsSimulationCheck[];
  config: RgsSimulationReportConfig;
  declared: RgsSimulationDeclaredMetrics;
  passed: boolean;
  realized: RgsSimulationRealizedMetrics;
  run: RgsSimulationRun;
  schemaVersion: typeof RGS_SIMULATION_REPORT_SCHEMA_VERSION;
  simulatorVersion: typeof RGS_SIMULATOR_VERSION;
  tolerances: RgsSimulationTolerances;
}

export interface RgsSimulationReport extends UnsignedRgsSimulationReport {
  reportHash: string;
}

export interface RgsSimulationVerification {
  errors: readonly string[];
  valid: boolean;
}

export interface RgsSimulationEvidenceEntry {
  activation: RgsModeActivation;
  configHash: string;
  mathConfigHash: string;
  minimumRounds: number;
  mode: RgsMode;
  realValueGate: 'hitl-required';
  reportHash: string;
  reportPath: string;
  rulesHash: string;
}

export interface RgsSimulationEvidenceManifest {
  entries: readonly RgsSimulationEvidenceEntry[];
  schemaVersion: typeof RGS_SIMULATION_MANIFEST_SCHEMA_VERSION;
}

export interface RgsSimulationPromotionEvaluation {
  errors: readonly string[];
  promotionAuthorized: false;
  realValueGate: 'hitl-required';
  simulationGatePassed: boolean;
  targetActivation: 'devnet';
}
