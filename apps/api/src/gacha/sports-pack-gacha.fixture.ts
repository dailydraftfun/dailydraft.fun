import { createHash } from 'node:crypto';
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import {
  ESCROW_DUEL_VERSION,
  ESCROW_V2_PROGRAM_ID,
  SETTLE_DUEL_DISCRIMINATOR,
} from '../contracts/dailydraft-escrow-v2.js';
import {
  type AcquiredGachaCard,
  type AcquireGachaCardInput,
  type SettledGachaRip,
  type SettleGachaRipInput,
  type SportsPackGachaCard,
  type SportsPackGachaMachine,
  SportsPackGachaProvider,
  type SportsPackGachaSport,
} from './sports-pack-gacha.provider.js';

const FIXTURE_TIMESTAMP = new Date('2026-07-24T12:00:00.000Z');
const SPORTS = ['football', 'soccer', 'baseball', 'basketball'] as const;
const TIERS = [
  { label: '$50', priceMinor: '50000000' },
  { label: '$100', priceMinor: '100000000' },
  { label: '$250', priceMinor: '250000000' },
] as const;

const FIXTURE_MACHINES: readonly SportsPackGachaMachine[] = Object.freeze(
  SPORTS.flatMap((sport) =>
    TIERS.map((tier) =>
      Object.freeze({
        committedPoolSize: 4,
        displayName: `${titleCase(sport)} ${tier.label} Devnet Fixture`,
        machineKey: `collector-crypt-${sport}-${tier.priceMinor}-devnet-fixture`,
        sport,
        tierPriceMinor: tier.priceMinor,
      }),
    ),
  ),
);

export const sportsPackGachaFixtureMachines = FIXTURE_MACHINES;

@Injectable()
export class FixtureSportsPackGachaProvider extends SportsPackGachaProvider {
  readonly capabilities = Object.freeze({
    acquisition: true,
    odds: true,
    provider: true,
    settlement: true,
  });
  readonly mode = 'fixture' as const;

  async acquireCard(input: AcquireGachaCardInput): Promise<AcquiredGachaCard> {
    requireFixtureMode();
    return {
      acquisitionReference: [
        'solana-devnet',
        ESCROW_V2_PROGRAM_ID.toBase58(),
        `duel-v${ESCROW_DUEL_VERSION}`,
        'card-acquisition',
        digest(`${input.ripId}:${input.assetReference}:${input.recipientWallet}`),
      ].join(':'),
      status: 'acquired',
    };
  }

  async getEligibleCards(machineKey: string): Promise<readonly SportsPackGachaCard[]> {
    requireFixtureMode();
    const machine = FIXTURE_MACHINES.find((candidate) => candidate.machineKey === machineKey);
    if (!machine) throw new NotFoundException('Gacha fixture machine was not found');
    return sportsPackGachaFixtureCards(machine);
  }

  async listMachines(): Promise<readonly SportsPackGachaMachine[]> {
    requireFixtureMode();
    return FIXTURE_MACHINES;
  }

  async settleRip(input: SettleGachaRipInput): Promise<SettledGachaRip> {
    requireFixtureMode();
    return {
      settlementReference: [
        'solana-devnet',
        ESCROW_V2_PROGRAM_ID.toBase58(),
        `duel-v${ESCROW_DUEL_VERSION}`,
        Buffer.from(SETTLE_DUEL_DISCRIMINATOR).toString('hex'),
        digest(`${input.ripId}:${input.acquisitionReference}`),
      ].join(':'),
      status: 'settled',
    };
  }
}

export function gachaFixtureModeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.DAILYDRAFT_GACHA_FIXTURE_MODE !== 'true') return false;
  if (environment.VERCEL_ENV === 'production') return false;
  return (
    environment.NODE_ENV === 'test' ||
    environment.NODE_ENV === 'development' ||
    environment.VERCEL_ENV === 'preview'
  );
}

export function sportsPackGachaFixtureCards(
  machine: SportsPackGachaMachine,
): readonly SportsPackGachaCard[] {
  const values = ['35000000', '75000000', '150000000', '350000000'] as const;
  return Object.freeze(
    values.map((amount, index) =>
      Object.freeze({
        assetReference: `devnet:fixture:${machine.machineKey}:asset:${index + 1}`,
        displayName: `${titleCase(machine.sport)} Devnet Fixture Card ${index + 1}`,
        graded: true,
        graderReference: `fixture-grader:${machine.sport}:psa`,
        insuredValue: Object.freeze({
          amount,
          currency: 'USDC' as const,
          decimals: 6 as const,
          providerReference: `fixture-insured:${machine.machineKey}:${index + 1}`,
          sourceTimestamp: new Date(FIXTURE_TIMESTAMP),
        }),
        inventorySourceTimestamp: new Date(FIXTURE_TIMESTAMP),
        poolOpen: true,
        providerCardReference: `fixture-card:${machine.machineKey}:${index + 1}`,
        sport: machine.sport,
        tierEnabled: true,
        valuationSourceReference: `fixture-valuation:${machine.machineKey}:${index + 1}`,
        vaulted: true,
      }),
    ),
  );
}

function requireFixtureMode(): void {
  if (!gachaFixtureModeEnabled()) {
    throw new ServiceUnavailableException(
      'Sports Pack Gacha fixtures are disabled outside explicit fixture or preview mode',
    );
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function titleCase(value: SportsPackGachaSport): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
