import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { PokemonTcgClient } from '../providers/pokemon-tcg.client.js';
import {
  DEVNET_DEMO_VALUATION_POLICY,
  DEVNET_DEMO_VALUATION_POLICY_HASH,
} from '../providers/valuation-policy.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DevnetDemoSignerService } from '../transactions/devnet-demo-signer.service.js';
import {
  type GachaCapabilityGates,
  gachaDevnetCapabilities,
  gachaDevnetModeEnabled,
} from './gacha-capability.js';
import type {
  AcquiredGachaCard,
  AcquireGachaCardInput,
  SettledGachaRip,
  SettleGachaRipInput,
  SportsPackGachaCard,
  SportsPackGachaMachine,
  SportsPackGachaSport,
} from './sports-pack-gacha.provider.js';
import { SportsPackGachaProvider } from './sports-pack-gacha.provider.js';

export const GACHA_DEVNET_POOL_VERSION = 'dailydraft-devnet-sports-pack.v1';

/**
 * Bumped whenever the shape of an acquisition or settlement reference changes,
 * so an older reference can never be mistaken for a current one. This mirrors
 * `duel-v${ESCROW_DUEL_VERSION}` in the duel references without borrowing the
 * escrow program's vocabulary — see `acquireCard` for why.
 */
const GACHA_DEVNET_CUSTODY_VERSION = 1;

const SPORTS: readonly SportsPackGachaSport[] = Object.freeze([
  'football',
  'soccer',
  'baseball',
  'basketball',
]);

const TIERS = Object.freeze([
  { label: '$50', priceMinor: '50000000' },
  { label: '$100', priceMinor: '100000000' },
  { label: '$250', priceMinor: '250000000' },
] as const);

const COMMITTED_POOL_SIZE = 4;

/**
 * Real, permanently-listed Base Set cards. The devnet pool is deliberately
 * larger than one machine's window so the twelve machines each commit to a
 * different slice: machine `n` takes the four cards starting at index `n`,
 * wrapping around. Adjacent machines therefore overlap by three cards, which is
 * harmless because both `assetReference` and `providerCardReference` are
 * machine-scoped — a devnet asset is a synthetic per-machine vault entry backed
 * by a real market valuation, not a claim on a unique physical card. Production
 * Collector Crypt inventory supplies genuinely unique vaulted assets.
 */
const CARD_POOL = Object.freeze([
  'base1-1',
  'base1-2',
  'base1-3',
  'base1-4',
  'base1-5',
  'base1-6',
  'base1-7',
  'base1-8',
  'base1-9',
  'base1-10',
  'base1-11',
  'base1-12',
  'base1-13',
  'base1-14',
  'base1-15',
  'base1-16',
] as const);

const DEVNET_MACHINES: readonly SportsPackGachaMachine[] = Object.freeze(
  SPORTS.flatMap((sport) =>
    TIERS.map((tier) =>
      Object.freeze({
        committedPoolSize: COMMITTED_POOL_SIZE,
        displayName: `${titleCase(sport)} ${tier.label} Devnet Pack`,
        machineKey: devnetMachineKey(sport, tier.priceMinor),
        sport,
        tierPriceMinor: tier.priceMinor,
      }),
    ),
  ),
);

@Injectable()
export class DevnetSportsPackGachaProvider extends SportsPackGachaProvider {
  readonly mode = 'dailydraft-devnet' as const;

  constructor(
    private readonly pokemon: PokemonTcgClient,
    private readonly signer: DevnetDemoSignerService,
  ) {
    super();
  }

  /**
   * Reads configuration only. `signer.publicKey` throws when no keypair is
   * configured, and `GachaRipService.capability()` is a plain synchronous
   * getter that must never fail, so the signer is deliberately untouched here.
   */
  get capabilities(): Readonly<GachaCapabilityGates> {
    return Object.freeze(gachaDevnetCapabilities());
  }

  /**
   * A rip is single-player, so there is no duel account and therefore no
   * escrow vault PDA to deposit into — `DevnetDemoSignerService.ensureCardDeposited`
   * requires both. Custody on devnet is attested by the provider signer instead:
   * the reference is a MAC over the rip, asset, and recipient, which the signer
   * alone can produce and anyone holding the same secret can re-derive.
   */
  async acquireCard(input: AcquireGachaCardInput): Promise<AcquiredGachaCard> {
    requireDevnetMode();
    await this.signer.assertReady();

    return {
      acquisitionReference: this.custodyReference('card-acquisition', [
        input.ripId,
        input.assetReference,
        input.recipientWallet,
      ]),
      status: 'acquired',
    };
  }

  async getEligibleCards(machineKey: string): Promise<readonly SportsPackGachaCard[]> {
    requireDevnetMode();
    await this.signer.assertReady();

    const machineIndex = DEVNET_MACHINES.findIndex(
      (candidate) => candidate.machineKey === machineKey,
    );
    const machine = DEVNET_MACHINES[machineIndex];
    if (!machine) {
      throw new NotFoundException('Gacha devnet machine was not found');
    }

    // One observation timestamp for the whole pool: the snapshot policy measures
    // valuation staleness against the latest evidence timestamp, and reading the
    // inventory *now* is what makes that a real freshness gate against live
    // market data rather than a self-referential one.
    const observedAt = new Date();
    const graderReference = `dailydraft-devnet-vault:${this.signer.publicKey.toBase58()}`;

    return Object.freeze(
      await Promise.all(
        machineCardIds(machineIndex).map(async (cardId) => {
          const card = await this.pokemon.getCard(cardId);
          const providerCardReference = `${GACHA_DEVNET_POOL_VERSION}:${machine.machineKey}:${cardId}`;

          return Object.freeze({
            assetReference: `devnet:sports-pack:${machine.machineKey}:${cardId}:${this.signer
              .referenceMac(providerCardReference)
              .slice(0, 32)}`,
            displayName: card.displayName,
            graded: true,
            graderReference,
            insuredValue: Object.freeze({
              amount: card.marketValueMicroUsdc,
              currency: 'USDC' as const,
              decimals: 6 as const,
              providerReference: `pokemon-tcg:${cardId}:${card.priceVariant}:${card.priceUpdatedAt}`,
              sourceTimestamp: card.sourceTimestamp,
            }),
            inventorySourceTimestamp: observedAt,
            poolOpen: true,
            providerCardReference,
            sport: machine.sport,
            tierEnabled: true,
            // `SportsPackGachaCard` has no dedicated policy-hash field, so the
            // pinned valuation policy travels in the valuation source reference
            // that the snapshot seals into its content hash.
            valuationSourceReference: `${DEVNET_DEMO_VALUATION_POLICY.policyVersion}:${DEVNET_DEMO_VALUATION_POLICY_HASH}:${cardId}`,
            vaulted: true,
          });
        }),
      ),
    );
  }

  async listMachines(): Promise<readonly SportsPackGachaMachine[]> {
    requireDevnetMode();
    return DEVNET_MACHINES;
  }

  async settleRip(input: SettleGachaRipInput): Promise<SettledGachaRip> {
    requireDevnetMode();
    await this.signer.assertReady();

    return {
      settlementReference: this.custodyReference('rip-settlement', [
        input.ripId,
        input.acquisitionReference,
      ]),
      status: 'settled',
    };
  }

  private custodyReference(action: string, parts: readonly string[]): string {
    return [
      'solana-devnet',
      this.signer.publicKey.toBase58(),
      `sports-pack-vault-v${GACHA_DEVNET_CUSTODY_VERSION}`,
      action,
      this.signer.referenceMac(`${action}:${parts.join(':')}`),
    ].join(':');
  }
}

export function devnetMachineKey(sport: SportsPackGachaSport, tierPriceMinor: string): string {
  return `dailydraft-devnet-${sport}-${tierPriceMinor}`;
}

export function machineCardIds(machineIndex: number): readonly string[] {
  return Array.from({ length: COMMITTED_POOL_SIZE }, (_unused, offset) => {
    const cardId = CARD_POOL[(machineIndex + offset) % CARD_POOL.length];
    if (!cardId) {
      throw new ServiceUnavailableException('Gacha devnet card pool is empty');
    }
    return cardId;
  });
}

function requireDevnetMode(): void {
  if (!gachaDevnetModeEnabled()) {
    throw new ServiceUnavailableException(
      'Sports Pack Gacha devnet inventory is disabled outside dailydraft-devnet provider mode',
    );
  }
}

function titleCase(value: SportsPackGachaSport): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
