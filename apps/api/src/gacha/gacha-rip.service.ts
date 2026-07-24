import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type DatabaseClient, GachaRipStatus, type Prisma } from '@openpacksduel/db';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import { resolveGachaCapability } from './gacha-capability.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import {
  fixtureSnapshotInput,
  GachaInventorySnapshotService,
} from './gacha-inventory-snapshot.service.js';
import {
  createFixtureGachaPullOddsRuleSet,
  type GachaPullOddsBand,
  type GachaPullOddsRuleSet,
  validateGachaPullOddsRuleSet,
} from './gacha-pull-odds.js';
import { gachaFixtureModeEnabled } from './sports-pack-gacha.fixture.js';
// biome-ignore lint/style/useImportType: Nest uses the provider class as a runtime injection token.
import { SportsPackGachaProvider } from './sports-pack-gacha.provider.js';

const GACHA_ODDS_LOCK_NAMESPACE = 1_191_047_330;
const MAX_SEED_LENGTH = 240;

export interface CreateFixtureGachaRipInput {
  machineKey: string;
  oddsVersion?: number;
  recipientWallet: string;
  seed: string;
}

interface SelectableEntry {
  assetReference: string | null;
  eligible: boolean;
  insuredValueMinor: string | null;
}

@Injectable()
export class GachaRipService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly snapshots: GachaInventorySnapshotService,
    private readonly provider: SportsPackGachaProvider,
  ) {}

  capability() {
    return {
      ...resolveGachaCapability(this.provider.capabilities),
      gates: this.provider.capabilities,
      providerMode: this.provider.mode,
    };
  }

  async findCommittedOdds(machineKey: string) {
    const commitment = await this.database.gachaPullOddsCommitment.findFirst({
      orderBy: [{ version: 'desc' }, { committedAt: 'desc' }],
      where: {
        machineKey: requireKey(machineKey, 'machineKey'),
        sealedAt: { not: null },
      },
    });
    if (!commitment) {
      throw new ServiceUnavailableException('No sealed Gacha odds commitment is available');
    }
    return commitment;
  }

  async createFixtureRip(input: CreateFixtureGachaRipInput) {
    if (!gachaFixtureModeEnabled()) {
      throw new ServiceUnavailableException(
        'Sports Pack Gacha rips are disabled outside explicit fixture or preview mode',
      );
    }
    const machineKey = requireKey(input.machineKey, 'machineKey');
    const recipientWallet = requireReference(input.recipientWallet, 'recipientWallet');
    const seed = requireSeed(input.seed);
    const oddsVersion = requirePositiveInteger(input.oddsVersion ?? 1, 'oddsVersion');
    const snapshot = await this.ensureFixtureSnapshot(machineKey);
    if (!snapshot.sealedAt) {
      throw new ServiceUnavailableException('Gacha inventory snapshot is not sealed');
    }
    const rules = validateGachaPullOddsRuleSet(
      createFixtureGachaPullOddsRuleSet(snapshot.contentHash),
    );
    const ripId = createId('gacharip');
    const selectedAt = new Date();
    const seedCommitmentHash = sha256(seed);
    const oddsKey = `${machineKey}:fixture-odds`;

    const { commitment: oddsCommitment, selected } = await this.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${oddsKey}, ${GACHA_ODDS_LOCK_NAMESPACE})
        )
      `;
        const commitment = await ensureOddsCommitment(
          transaction,
          machineKey,
          oddsKey,
          oddsVersion,
          rules,
          selectedAt,
        );
        const selected = selectGachaOutcome(snapshot.entries, rules, seed);
        await transaction.gachaRip.create({
          data: {
            id: ripId,
            insuredValueCurrency: 'USDC',
            insuredValueDecimals: 6,
            insuredValueMinor: selected.insuredValueMinor,
            machineKey,
            oddsCommitmentId: commitment.id,
            oddsRulesHash: rules.rulesHash,
            seedCommitmentHash,
            selectedAssetReference: selected.assetReference,
            selectedAt,
            snapshotContentHash: snapshot.contentHash,
            status: GachaRipStatus.SELECTED,
          },
        });
        return { commitment, selected };
      },
    );

    try {
      await this.advanceRip(ripId, GachaRipStatus.SELECTED, {
        revealedAt: new Date(),
        status: GachaRipStatus.REVEALED,
      });
      const acquired = await this.provider.acquireCard({
        assetReference: selected.assetReference,
        recipientWallet,
        ripId,
      });
      await this.advanceRip(ripId, GachaRipStatus.REVEALED, {
        acquiredAt: new Date(),
        acquisitionReference: acquired.acquisitionReference,
        status: GachaRipStatus.ACQUIRED,
      });
      const settled = await this.provider.settleRip({
        acquisitionReference: acquired.acquisitionReference,
        ripId,
      });
      await this.advanceRip(ripId, GachaRipStatus.ACQUIRED, {
        settledAt: new Date(),
        settlementReference: settled.settlementReference,
        status: GachaRipStatus.SETTLED,
      });
    } catch (error) {
      await this.database.gachaRip.update({
        data: {
          failedAt: new Date(),
          failureReason: error instanceof Error ? error.message.slice(0, 240) : 'Unknown failure',
          status: GachaRipStatus.FAILED,
        },
        where: { id: ripId },
      });
      throw error;
    }

    const rip = await this.database.gachaRip.findUnique({ where: { id: ripId } });
    if (!rip) throw new ServiceUnavailableException('Gacha rip could not be reloaded');
    return {
      oddsCommitment: {
        calculatorVersion: oddsCommitment.calculatorVersion,
        committedAt: oddsCommitment.committedAt,
        oddsKey: oddsCommitment.oddsKey,
        rulesHash: oddsCommitment.rulesHash,
        schemaVersion: oddsCommitment.schemaVersion,
        snapshotContentHash: oddsCommitment.snapshotContentHash,
        version: oddsCommitment.version,
      },
      rip,
    };
  }

  private async ensureFixtureSnapshot(machineKey: string) {
    try {
      return await this.snapshots.findLatestSealed(machineKey);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
    }
    const machines = await this.provider.listMachines();
    const machine = machines.find((candidate) => candidate.machineKey === machineKey);
    if (!machine) throw new ConflictException('Gacha fixture machine is not configured');
    const candidates = await this.provider.getEligibleCards(machineKey);
    await this.snapshots.createFixtureSnapshot(fixtureSnapshotInput(machine, candidates));
    return this.snapshots.findLatestSealed(machineKey);
  }

  private async advanceRip(
    ripId: string,
    expectedStatus: GachaRipStatus,
    data: {
      acquiredAt?: Date;
      acquisitionReference?: string;
      revealedAt?: Date;
      settledAt?: Date;
      settlementReference?: string;
      status: GachaRipStatus;
    },
  ): Promise<void> {
    const updated = await this.database.gachaRip.updateMany({
      data,
      where: { id: ripId, status: expectedStatus },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Gacha rip lifecycle transition was rejected');
    }
  }
}

export function selectGachaOutcome(
  entries: readonly SelectableEntry[],
  rulesInput: unknown,
  seed: string,
): { assetReference: string; insuredValueMinor: string } {
  const rules = validateGachaPullOddsRuleSet(rulesInput);
  const eligible = entries
    .filter(
      (entry): entry is SelectableEntry & { assetReference: string; insuredValueMinor: string } =>
        entry.eligible &&
        typeof entry.assetReference === 'string' &&
        typeof entry.insuredValueMinor === 'string',
    )
    .sort((left, right) => {
      if (left.assetReference === right.assetReference) return 0;
      return left.assetReference < right.assetReference ? -1 : 1;
    });
  if (eligible.length === 0) {
    throw new ServiceUnavailableException('Gacha inventory snapshot has no eligible cards');
  }

  const digest = createHash('sha256')
    .update(`${rules.snapshotContentHash}:${rules.rulesHash}:${requireSeed(seed)}`)
    .digest();
  const rollPpm = digest.readUInt32BE(0) % 1_000_000;
  const band = bandForRoll(rules.bands, rollPpm);
  const candidates = eligible.filter(
    (entry) => bandForValue(rules.bands, BigInt(entry.insuredValueMinor)).label === band.label,
  );
  if (candidates.length === 0) {
    throw new ServiceUnavailableException(`Gacha inventory has no eligible ${band.label} cards`);
  }
  const selected = candidates[digest.readUInt32BE(4) % candidates.length];
  if (!selected) throw new ServiceUnavailableException('Gacha outcome selection failed');
  return {
    assetReference: selected.assetReference,
    insuredValueMinor: selected.insuredValueMinor,
  };
}

async function ensureOddsCommitment(
  transaction: Prisma.TransactionClient,
  machineKey: string,
  oddsKey: string,
  version: number,
  rules: GachaPullOddsRuleSet,
  committedAt: Date,
) {
  const existing = await transaction.gachaPullOddsCommitment.findUnique({
    where: { oddsKey_version: { oddsKey, version } },
  });
  if (existing) {
    if (
      !existing.sealedAt ||
      existing.machineKey !== machineKey ||
      existing.snapshotContentHash !== rules.snapshotContentHash ||
      existing.rulesHash !== rules.rulesHash
    ) {
      throw new ConflictException('Gacha odds commitment does not match the sealed snapshot');
    }
    return existing;
  }

  const probabilities = Object.fromEntries(
    rules.bands.map((band) => [band.label, band.probabilityPpm]),
  ) as Record<GachaPullOddsBand['label'], number>;
  return transaction.gachaPullOddsCommitment.create({
    data: {
      bandMinimums: Object.fromEntries(
        rules.bands.map((band) => [band.label, band.minimumInsuredValueMinor]),
      ) as Prisma.InputJsonValue,
      baseProbabilityPpm: probabilities.base,
      calculatorVersion: rules.calculatorVersion,
      chaseProbabilityPpm: probabilities.chase,
      committedAt,
      id: createId('gachaodds'),
      machineKey,
      oddsKey,
      plusProbabilityPpm: probabilities.plus,
      premiumProbabilityPpm: probabilities.premium,
      probabilityScalePpm: rules.probabilityScalePpm,
      rulesHash: rules.rulesHash,
      schemaVersion: rules.schemaVersion,
      sealedAt: committedAt,
      snapshotContentHash: rules.snapshotContentHash,
      version,
    },
  });
}

function bandForRoll(bands: readonly GachaPullOddsBand[], rollPpm: number): GachaPullOddsBand {
  let upperBound = 0;
  for (const band of bands) {
    upperBound += band.probabilityPpm;
    if (rollPpm < upperBound) return band;
  }
  throw new ServiceUnavailableException('Gacha probability bands do not cover the committed roll');
}

function bandForValue(
  bands: readonly GachaPullOddsBand[],
  insuredValueMinor: bigint,
): GachaPullOddsBand {
  let selected = bands[0];
  for (const band of bands) {
    if (insuredValueMinor < BigInt(band.minimumInsuredValueMinor)) break;
    selected = band;
  }
  if (!selected) throw new ServiceUnavailableException('Gacha probability bands are empty');
  return selected;
}

function requireKey(value: string, field: string): string {
  if (typeof value !== 'string') throw new ConflictException(`${field} is invalid`);
  const canonical = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(canonical)) {
    throw new ConflictException(`${field} is invalid`);
  }
  return canonical;
}

function requireSeed(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > MAX_SEED_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new ConflictException('seed is invalid');
  }
  return value;
}

function requireReference(value: string, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 240 ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new ConflictException(`${field} is invalid`);
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

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new ConflictException(`${field} is invalid`);
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}
