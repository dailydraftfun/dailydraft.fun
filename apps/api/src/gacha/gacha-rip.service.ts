import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { type DatabaseClient, GachaRipStatus, type Prisma } from '@dailydraft/db';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

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
const GACHA_SEED_COMMITMENT_TTL_MS = 15 * 60 * 1000;
const SERVER_SEED_PATTERN = /^[a-f0-9]{64}$/;

export interface CreateFixtureGachaRipInput {
  commitmentId: string;
  idempotencyKey?: string;
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

interface GachaSeeds {
  clientSeed: string;
  serverSeed: string;
}

type CreateFixtureRipOutcome =
  | {
      kind: 'created';
      ripId: string;
      selected: { assetReference: string; insuredValueMinor: string };
    }
  | { kind: 'existing'; ripId: string };

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

  async createSeedCommitment(machineKeyInput: string) {
    if (!gachaFixtureModeEnabled()) {
      throw new ServiceUnavailableException(
        'Sports Pack Gacha rip commitments are disabled outside explicit fixture or preview mode',
      );
    }
    const machineKey = requireKey(machineKeyInput, 'machineKey');
    const serverSeed = requireServerSeed(randomBytes(32).toString('hex'));
    const serverSeedHash = sha256(serverSeed);
    const committedAt = new Date();
    const expiresAt = new Date(committedAt.getTime() + GACHA_SEED_COMMITMENT_TTL_MS);
    const commitmentId = createId('gachaseed');

    await this.database.gachaRipSeedCommitment.create({
      data: {
        committedAt,
        expiresAt,
        id: commitmentId,
        machineKey,
        serverSeed,
        serverSeedHash,
      },
    });

    return { commitmentId, expiresAt, serverSeedHash };
  }

  async createFixtureRip(input: CreateFixtureGachaRipInput) {
    if (!gachaFixtureModeEnabled()) {
      throw new ServiceUnavailableException(
        'Sports Pack Gacha rips are disabled outside explicit fixture or preview mode',
      );
    }
    const machineKey = requireKey(input.machineKey, 'machineKey');
    const recipientWallet = requireReference(input.recipientWallet, 'recipientWallet');
    const clientSeed = requireSeed(input.seed);
    const commitmentId = requireReference(input.commitmentId, 'commitmentId');
    const idempotencyKey = optionalReference(input.idempotencyKey, 'idempotencyKey');
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
    const seedCommitmentHash = sha256(clientSeed);
    const oddsKey = `${machineKey}:fixture-odds`;

    const outcome = await this.database.$transaction(
      async (transaction): Promise<CreateFixtureRipOutcome> => {
        await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${oddsKey}, ${GACHA_ODDS_LOCK_NAMESPACE})
        )
      `;

        if (idempotencyKey) {
          const existing = await transaction.gachaRip.findFirst({
            where: { idempotencyKey, machineKey },
          });
          if (existing) return { kind: 'existing', ripId: existing.id };
        }

        const seedCommitment = await transaction.gachaRipSeedCommitment.findUnique({
          where: { id: commitmentId },
        });
        if (!seedCommitment || seedCommitment.machineKey !== machineKey) {
          throw new ConflictException('Gacha rip seed commitment was not found');
        }
        if (seedCommitment.consumedByRipId) {
          throw new ConflictException('Gacha rip seed commitment has already been consumed');
        }
        if (seedCommitment.expiresAt.getTime() <= selectedAt.getTime()) {
          throw new ConflictException('Gacha rip seed commitment has expired');
        }

        const commitment = await ensureOddsCommitment(
          transaction,
          machineKey,
          oddsKey,
          oddsVersion,
          rules,
          selectedAt,
        );

        const priorSelections = await transaction.gachaRip.findMany({
          select: { selectedAssetReference: true },
          where: {
            snapshotContentHash: snapshot.contentHash,
            status: { not: GachaRipStatus.FAILED },
          },
        });
        const excludedAssetReferences = new Set(
          priorSelections
            .map((rip) => rip.selectedAssetReference)
            .filter((reference): reference is string => typeof reference === 'string'),
        );

        const selected = selectGachaOutcome(
          snapshot.entries,
          rules,
          { clientSeed, serverSeed: seedCommitment.serverSeed },
          excludedAssetReferences,
        );

        await transaction.gachaRip.create({
          data: {
            id: ripId,
            idempotencyKey,
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

        const consumed = await transaction.gachaRipSeedCommitment.updateMany({
          data: { consumedByRipId: ripId },
          where: { consumedByRipId: null, expiresAt: { gt: selectedAt }, id: commitmentId },
        });
        if (consumed.count !== 1) {
          throw new ConflictException('Gacha rip seed commitment could not be consumed');
        }

        return { kind: 'created', ripId, selected };
      },
    );

    if (outcome.kind === 'created') {
      try {
        await this.advanceRip(ripId, GachaRipStatus.SELECTED, {
          revealedAt: new Date(),
          status: GachaRipStatus.REVEALED,
        });
        const acquired = await this.provider.acquireCard({
          assetReference: outcome.selected.assetReference,
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
        // The asset was never delivered, so release it back to the eligible pool for
        // the next rip against this snapshot instead of permanently burning it: clear
        // selectedAssetReference (which the depletion unique index covers) and keep
        // failedAssetReference as an audit trail of what this rip had selected.
        await this.database.gachaRip.update({
          data: {
            failedAssetReference: outcome.selected.assetReference,
            failedAt: new Date(),
            failureReason: error instanceof Error ? error.message.slice(0, 240) : 'Unknown failure',
            selectedAssetReference: null,
            status: GachaRipStatus.FAILED,
          },
          where: { id: ripId },
        });
        throw error;
      }
    }

    return this.loadRipResult(outcome.ripId);
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

  private async loadRipResult(ripId: string) {
    const rip = await this.database.gachaRip.findUnique({ where: { id: ripId } });
    if (!rip) throw new ServiceUnavailableException('Gacha rip could not be reloaded');
    const oddsCommitment = await this.database.gachaPullOddsCommitment.findUnique({
      where: { id: rip.oddsCommitmentId },
    });
    if (!oddsCommitment) {
      throw new ServiceUnavailableException('Gacha rip odds commitment could not be reloaded');
    }
    const revealed = await this.revealSeedCommitment(rip);
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
      serverSeed: revealed.serverSeed,
      serverSeedHash: revealed.serverSeedHash,
    };
  }

  private async revealSeedCommitment(rip: {
    id: string;
    status: GachaRipStatus;
  }): Promise<{ serverSeed: string | null; serverSeedHash: string | null }> {
    if (rip.status !== GachaRipStatus.SETTLED && rip.status !== GachaRipStatus.FAILED) {
      return { serverSeed: null, serverSeedHash: null };
    }
    const commitment = await this.database.gachaRipSeedCommitment.findUnique({
      where: { consumedByRipId: rip.id },
    });
    if (!commitment) return { serverSeed: null, serverSeedHash: null };
    return { serverSeed: commitment.serverSeed, serverSeedHash: commitment.serverSeedHash };
  }
}

export function selectGachaOutcome(
  entries: readonly SelectableEntry[],
  rulesInput: unknown,
  seeds: GachaSeeds,
  excludedAssetReferences: ReadonlySet<string> = new Set(),
): { assetReference: string; insuredValueMinor: string } {
  const rules = validateGachaPullOddsRuleSet(rulesInput);
  const eligible = entries
    .filter(
      (entry): entry is SelectableEntry & { assetReference: string; insuredValueMinor: string } =>
        entry.eligible &&
        typeof entry.assetReference === 'string' &&
        typeof entry.insuredValueMinor === 'string' &&
        !excludedAssetReferences.has(entry.assetReference),
    )
    .sort((left, right) => {
      if (left.assetReference === right.assetReference) return 0;
      return left.assetReference < right.assetReference ? -1 : 1;
    });
  if (eligible.length === 0) {
    throw new ServiceUnavailableException('Gacha inventory snapshot has no eligible cards');
  }

  const digest = createHash('sha256')
    .update(
      `${rules.snapshotContentHash}:${rules.rulesHash}:${requireServerSeed(seeds.serverSeed)}:${requireSeed(seeds.clientSeed)}`,
    )
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

function requireServerSeed(value: string): string {
  if (typeof value !== 'string' || !SERVER_SEED_PATTERN.test(value)) {
    throw new ConflictException('serverSeed is invalid');
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

function optionalReference(value: string | undefined, field: string): string | null {
  if (value === undefined) return null;
  return requireReference(value, field);
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
