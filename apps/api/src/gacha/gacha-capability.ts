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

export const GACHA_DEVNET_CAPABILITIES = Object.freeze({
  acquisition: false,
  odds: false,
  provider: false,
  settlement: false,
} satisfies GachaCapabilityGates);

export const GACHA_DEVNET_CAPABILITY = Object.freeze(
  resolveGachaCapability(GACHA_DEVNET_CAPABILITIES),
);

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
