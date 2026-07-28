import { PACK_TIER_CATALOG } from '../packs/pack-catalog.js';
import { currentValuationPolicy } from '../providers/valuation-policy.js';
import { readHouseTreasuryConfig } from '../treasury/house-treasury.policy.js';

type PublicCapabilityAvailability = {
  enabled: boolean;
  reason: string | null;
};

type ProductReadiness = {
  database: { reachable: boolean };
  provider: { configured: boolean; mode: string; verified: boolean };
  rpc: { verifiedDevnet: boolean };
  treasury: {
    configurationErrors: string[];
    entryEnabled: boolean;
    finalizedBalanceSnapshotFresh: boolean;
    unresolvedReconciliationDiscrepancies: number | null;
    verified: boolean;
  };
};

export type PublicHouseAdmissionDisclosure = {
  approvalStatus: 'devnet-preview-no-legal-or-live-provider-approval';
  currency: 'USDC';
  decimals: 6;
  limits: {
    dailyLossAmount: string;
    maxActivePerWallet: number;
    maxConcurrentPerTier: number;
    maxTotalExposureAmount: string;
    minimumLiquidityAmount: string;
  };
  network: 'solana-devnet';
  opponent: {
    label: 'DailyDraft House';
    wallet: string | null;
  };
  preFundingRecheck: 'immediately-before-duel-creation';
  valuation: {
    comparisonMetric: string;
    policyHash: string;
    policyVersion: string;
    tieRule: string;
  };
};

export type PublicProductCapabilities = {
  modes: {
    direct: PublicCapabilityAvailability;
    house: PublicCapabilityAvailability & {
      admission: PublicHouseAdmissionDisclosure;
    };
    open: PublicCapabilityAvailability;
  };
  network: 'solana-devnet';
  packs: Array<
    PublicCapabilityAvailability & {
      id: string;
      name: string;
      tier: 25 | 50 | 100;
    }
  >;
  provider: { mode: string; ready: boolean };
};

export function publicProductCapabilities(readiness: ProductReadiness): PublicProductCapabilities {
  const providerReady = readiness.provider.configured && readiness.provider.verified;
  const duelReady = readiness.database.reachable && readiness.rpc.verifiedDevnet && providerReady;
  const duelReason = duelReady ? null : 'Duel play is not ready on Solana devnet.';
  const houseReady = duelReady && readiness.treasury.entryEnabled && readiness.treasury.verified;
  const treasury = readHouseTreasuryConfig();
  const valuation = currentValuationPolicy();

  return {
    modes: {
      direct: { enabled: duelReady, reason: duelReason },
      house: {
        admission: {
          approvalStatus: 'devnet-preview-no-legal-or-live-provider-approval',
          currency: 'USDC',
          decimals: 6,
          limits: {
            dailyLossAmount: treasury.dailyLossLimit.toString(),
            maxActivePerWallet: treasury.maxActivePerWallet,
            maxConcurrentPerTier: treasury.maxConcurrentPerTier,
            maxTotalExposureAmount: treasury.maxTotalExposure.toString(),
            minimumLiquidityAmount: treasury.minimumLiquidity.toString(),
          },
          network: 'solana-devnet',
          opponent: {
            label: 'DailyDraft House',
            wallet: treasury.houseWallet,
          },
          preFundingRecheck: 'immediately-before-duel-creation',
          valuation: {
            comparisonMetric: valuation.policy.comparisonMetric,
            policyHash: valuation.policyHash,
            policyVersion: valuation.policy.policyVersion,
            tieRule: valuation.policy.tieRule,
          },
        },
        enabled: houseReady,
        reason: houseReady ? null : houseUnavailableReason(readiness, duelReason),
      },
      open: { enabled: duelReady, reason: duelReason },
    },
    network: 'solana-devnet',
    packs: PACK_TIER_CATALOG.map((pack) => ({
      enabled: pack.supported && duelReady,
      id: pack.id,
      name: pack.name,
      reason: pack.supported ? duelReason : pack.comingSoonReason,
      tier: pack.tier,
    })),
    provider: { mode: readiness.provider.mode, ready: providerReady },
  };
}

function houseUnavailableReason(readiness: ProductReadiness, duelReason: string | null): string {
  if (duelReason) return duelReason;
  if (!readiness.treasury.entryEnabled) {
    return 'House admission is disabled by the reviewed runtime configuration.';
  }
  if (readiness.treasury.configurationErrors.length > 0) {
    return `House admission is blocked by treasury configuration: ${readiness.treasury.configurationErrors
      .map((error) => error.replaceAll('_', ' '))
      .join(', ')}.`;
  }
  if (
    readiness.treasury.unresolvedReconciliationDiscrepancies === null ||
    readiness.treasury.unresolvedReconciliationDiscrepancies > 0
  ) {
    return 'House admission is blocked until all treasury reconciliation discrepancies are resolved.';
  }
  if (!readiness.treasury.finalizedBalanceSnapshotFresh) {
    return 'House admission is blocked until a fresh finalized treasury balance is verified.';
  }
  return 'House admission is not currently available on Solana devnet.';
}
