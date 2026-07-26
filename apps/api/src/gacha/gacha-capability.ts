import {
  type HouseTreasuryConfig,
  readHouseTreasuryConfig,
} from '../treasury/house-treasury.policy.js';
import { gachaDepositConfigurationErrors } from './gacha-payment.service.js';

export interface GachaCapabilityGates {
  acquisition: boolean;
  odds: boolean;
  provider: boolean;
  settlement: boolean;
}

export interface GachaCapability {
  availability: 'playable' | 'preview';
  reason: string;
}

/**
 * `DAILYDRAFT_PROVIDER_MODE` is the repo-wide devnet provider selector — duels,
 * matchmaking, and `valuation-policy.ts` all key off it, and
 * `deployment-environment.ts` requires it in production. Gacha reuses the same
 * variable rather than inventing its own so a deployment cannot end up
 * half-devnet.
 */
export function gachaDevnetModeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.DAILYDRAFT_PROVIDER_MODE === 'dailydraft-devnet';
}

/**
 * The devnet gates are computed rather than hardcoded, so a half-configured
 * deployment reports `preview` instead of advertising a rail it cannot serve.
 *
 * `provider` and `odds` ride on devnet mode alone: the devnet sports pack
 * provider supplies the pool and committed odds are already implemented.
 * `acquisition` and `settlement` additionally need a usable house deposit
 * destination, because a single-player rip is paid for by an SPL transfer
 * verified in `gacha-payment.service.ts` rather than by an escrow instruction.
 *
 * `readHouseTreasuryConfig` never throws — every field goes through a
 * defensive reader — which is what makes this safe to call from the
 * synchronous `capabilities` getter on the provider.
 */
export function gachaDevnetCapabilities(
  environment: NodeJS.ProcessEnv = process.env,
  config: HouseTreasuryConfig = readHouseTreasuryConfig(environment),
): GachaCapabilityGates {
  const devnet = gachaDevnetModeEnabled(environment);
  const depositReady = devnet && gachaDepositConfigurationErrors(config).length === 0;

  return {
    acquisition: depositReady,
    odds: devnet,
    provider: devnet,
    settlement: depositReady,
  };
}

export function gachaDevnetCapability(
  environment: NodeJS.ProcessEnv = process.env,
): GachaCapability {
  return resolveGachaCapability(gachaDevnetCapabilities(environment));
}

export function resolveGachaCapability(gates: GachaCapabilityGates): GachaCapability {
  const missing = (
    [
      ['provider', gates.provider],
      ['odds', gates.odds],
      ['acquisition', gates.acquisition],
      ['settlement', gates.settlement],
    ] as const
  )
    .filter(([, enabled]) => !enabled)
    .map(([gate]) => gate);

  if (missing.length === 0) {
    return {
      availability: 'playable',
      reason: 'Provider, odds, acquisition, and settlement gates are ready',
    };
  }

  return {
    availability: 'preview',
    reason: `Pending Gacha capability gates: ${missing.join(', ')}`,
  };
}
