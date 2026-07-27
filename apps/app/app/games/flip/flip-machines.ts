export type FlipSport = 'baseball' | 'basketball' | 'football' | 'soccer';

export type FlipMachine = {
  machineKey: string;
  sport: FlipSport;
  sportLabel: string;
  tierLabel: string;
  tierPriceMinor: string;
};

/**
 * Mirror of the devnet provider's machine grid, derived rather than fetched.
 *
 * The gacha controller exposes no machine listing route — every read is keyed
 * by a machine key the caller already holds — so this surface reconstructs the
 * twelve devnet machines from `devnetMachineKey(sport, tierPriceMinor)`. The
 * guess is never trusted: `GET /gacha/machines/:key/inventory` echoes the
 * machine back with its own display name and tier price, so a key this file got
 * wrong surfaces as a 404 the player can see rather than a silent mismatch.
 */
const SPORTS: readonly { label: string; sport: FlipSport }[] = Object.freeze([
  { label: 'Football', sport: 'football' },
  { label: 'Soccer', sport: 'soccer' },
  { label: 'Baseball', sport: 'baseball' },
  { label: 'Basketball', sport: 'basketball' },
]);

const TIERS: readonly { label: string; priceMinor: string }[] = Object.freeze([
  { label: '$50', priceMinor: '50000000' },
  { label: '$100', priceMinor: '100000000' },
  { label: '$250', priceMinor: '250000000' },
]);

export const FLIP_SPORTS: readonly { label: string; sport: FlipSport }[] = SPORTS;
export const FLIP_TIERS: readonly { label: string; priceMinor: string }[] = TIERS;

export function flipMachineKey(sport: FlipSport, tierPriceMinor: string): string {
  return `dailydraft-devnet-${sport}-${tierPriceMinor}`;
}

export const FLIP_MACHINES: readonly FlipMachine[] = Object.freeze(
  SPORTS.flatMap(({ label, sport }) =>
    TIERS.map((tier) =>
      Object.freeze({
        machineKey: flipMachineKey(sport, tier.priceMinor),
        sport,
        sportLabel: label,
        tierLabel: tier.label,
        tierPriceMinor: tier.priceMinor,
      }),
    ),
  ),
);

export const DEFAULT_FLIP_MACHINE = FLIP_MACHINES[0] as FlipMachine;

export function findFlipMachine(sport: FlipSport, tierPriceMinor: string): FlipMachine | undefined {
  return FLIP_MACHINES.find(
    (machine) => machine.sport === sport && machine.tierPriceMinor === tierPriceMinor,
  );
}
