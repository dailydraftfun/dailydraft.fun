import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { GachaCapabilityGates } from './gacha-capability.js';

export type SportsPackGachaSport = 'baseball' | 'basketball' | 'football' | 'soccer';

export interface SportsPackGachaMachine {
  committedPoolSize: number;
  displayName: string;
  machineKey: string;
  sport: SportsPackGachaSport;
  tierPriceMinor: string;
}

export interface SportsPackGachaCard {
  assetReference?: string;
  displayName: string;
  graded: boolean;
  graderReference?: string;
  insuredValue?: {
    amount: string;
    currency: 'USDC';
    decimals: 6;
    providerReference: string;
    sourceTimestamp: Date;
  };
  inventorySourceTimestamp: Date;
  poolOpen: boolean;
  providerCardReference: string;
  sport: SportsPackGachaSport;
  tierEnabled: boolean;
  valuationSourceReference?: string;
  vaulted: boolean;
}

export interface AcquireGachaCardInput {
  assetReference: string;
  recipientWallet: string;
  ripId: string;
}

export interface AcquiredGachaCard {
  acquisitionReference: string;
  status: 'acquired';
}

export interface SettleGachaRipInput {
  acquisitionReference: string;
  ripId: string;
}

export interface SettledGachaRip {
  settlementReference: string;
  status: 'settled';
}

export abstract class SportsPackGachaProvider {
  abstract readonly capabilities: Readonly<GachaCapabilityGates>;
  abstract readonly mode: 'collector-crypt' | 'dailydraft-devnet' | 'fixture';

  abstract acquireCard(input: AcquireGachaCardInput): Promise<AcquiredGachaCard>;
  abstract getEligibleCards(machineKey: string): Promise<readonly SportsPackGachaCard[]>;
  abstract listMachines(): Promise<readonly SportsPackGachaMachine[]>;
  abstract settleRip(input: SettleGachaRipInput): Promise<SettledGachaRip>;
}

@Injectable()
export class CollectorCryptSportsPackGachaProvider extends SportsPackGachaProvider {
  readonly capabilities = Object.freeze({
    acquisition: false,
    odds: false,
    provider: false,
    settlement: false,
  });
  readonly mode = 'collector-crypt' as const;

  async acquireCard(_input: AcquireGachaCardInput): Promise<AcquiredGachaCard> {
    return unavailable();
  }

  async getEligibleCards(_machineKey: string): Promise<readonly SportsPackGachaCard[]> {
    return unavailable();
  }

  async listMachines(): Promise<readonly SportsPackGachaMachine[]> {
    return unavailable();
  }

  async settleRip(_input: SettleGachaRipInput): Promise<SettledGachaRip> {
    return unavailable();
  }
}

function unavailable(): never {
  throw new ServiceUnavailableException(
    'Sports Pack Gacha operations are disabled until the Collector Crypt partner API contract is confirmed',
  );
}
