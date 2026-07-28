import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  createRgsSeedCommitment,
  createRgsSeededProof,
  deriveRgsSeededEntropy,
  type RgsSeededProof,
} from '@dailydraft/contracts';
import { type DatabaseClient, GachaRipStatus, type Prisma } from '@dailydraft/db';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { rarityForSerializedValue } from '../common/pull-rarity.js';
import { acquireNamespacedAdvisoryTransactionLock } from '../database/advisory-lock.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import { gachaDevnetModeEnabled, resolveGachaCapability } from './gacha-capability.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import {
  GachaInventorySnapshotService,
  snapshotInputForMode,
} from './gacha-inventory-snapshot.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GachaPaymentService } from './gacha-payment.service.js';
import {
  createFixtureGachaPullOddsRuleSet,
  type GachaPullOddsBand,
  type GachaPullOddsRuleSet,
  gachaPullOddsBandForRoll,
  gachaPullOddsBandForValue,
  validateGachaPullOddsRuleSet,
} from './gacha-pull-odds.js';
import { gachaFixtureModeEnabled } from './sports-pack-gacha.fixture.js';
// biome-ignore lint/style/useImportType: Nest uses the provider class as a runtime injection token.
import {
  GachaCardDefinitelyNotAcquiredError,
  SportsPackGachaProvider,
} from './sports-pack-gacha.provider.js';

const GACHA_ODDS_LOCK_NAMESPACE = 1_191_047_330;
const MAX_SEED_LENGTH = 240;
const GACHA_SEED_COMMITMENT_TTL_MS = 15 * 60 * 1000;
const GACHA_RIP_LIFECYCLE_LEASE_MS = 2 * 60 * 1000;
const GACHA_BOOTSTRAP_RETRY_MS = 30_000;
const SERVER_SEED_PATTERN = /^[a-f0-9]{64}$/;
const INCOMPLETE_RIP_STATUSES = [
  GachaRipStatus.SELECTED,
  GachaRipStatus.REVEALED,
  GachaRipStatus.ACQUIRED,
] as const;

export interface CreateFixtureGachaRipInput {
  commitmentId: string;
  idempotencyKey?: string;
  machineKey: string;
  oddsVersion?: number;
  /**
   * Verified `GachaRipPayment` intent funding this rip. Required whenever
   * {@link gachaRipRequiresPayment} is true; ignored in fixture mode, where rips
   * stay free so deterministic previews and tests need no chain access.
   */
  paymentIntentId?: string;
  recipientWallet: string;
  seed: string;
}

/**
 * Fixture wins over devnet, matching `GachaModule`'s provider factory and
 * `snapshotInputForMode`: a deployment that turns fixtures on is asking for
 * deterministic, unfunded rips even when devnet credentials are present.
 */
export function gachaRipRequiresPayment(): boolean {
  return !gachaFixtureModeEnabled() && gachaDevnetModeEnabled();
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
  | { kind: 'created'; ripId: string }
  | { kind: 'existing'; ripId: string };

type GachaRipRow = NonNullable<Awaited<ReturnType<DatabaseClient['gachaRip']['findUnique']>>>;

@Injectable()
export class GachaRipService {
  readonly #logger = new Logger(GachaRipService.name);
  #bootstrapFailed = false;
  #bootstrapRetry: ReturnType<typeof setTimeout> | undefined;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly snapshots: GachaInventorySnapshotService,
    private readonly provider: SportsPackGachaProvider,
    private readonly payments: GachaPaymentService,
  ) {}

  capability() {
    const capability = resolveGachaCapability(this.provider.capabilities);
    return {
      ...(capability.availability === 'playable' && this.#bootstrapFailed
        ? {
            availability: 'preview' as const,
            reason: 'Gacha inventory readiness could not be verified. Rip actions are unavailable.',
          }
        : capability),
      gates: this.provider.capabilities,
      providerMode: this.provider.mode,
    };
  }

  async findCommittedInventory(machineKey: string) {
    const canonicalMachineKey = requireKey(machineKey, 'machineKey');
    const oddsCommitment = await this.requireCommittedOdds(canonicalMachineKey);
    return this.snapshots.findSealed(canonicalMachineKey, oddsCommitment.snapshotContentHash);
  }

  async findCommittedOdds(machineKey: string) {
    return this.requireCommittedOdds(requireKey(machineKey, 'machineKey'));
  }

  /**
   * Prepare every configured machine before the HTTP server starts accepting
   * traffic. This keeps public GETs read-only while making a clean deployment
   * self-sufficient without an operator racing the first player.
   */
  async bootstrapConfiguredMachines() {
    if (
      (!gachaFixtureModeEnabled() && !gachaDevnetModeEnabled()) ||
      resolveGachaCapability(this.provider.capabilities).availability !== 'playable'
    ) {
      return [];
    }
    const prepared = [];
    try {
      for (const machine of await this.provider.listMachines()) {
        prepared.push(await this.ensureMachineReadiness(machine.machineKey));
      }
      this.#bootstrapFailed = false;
      this.clearBootstrapRetry();
    } catch (error) {
      this.#bootstrapFailed = true;
      this.#logger.error(
        JSON.stringify({
          event: 'gacha_bootstrap_failed',
          failure: error instanceof Error ? error.name : 'unknown',
          preparedMachines: prepared.length,
        }),
      );
      this.scheduleBootstrapRetry();
    }
    return prepared;
  }

  async createSeedCommitment(machineKeyInput: string) {
    if (!gachaFixtureModeEnabled() && !gachaDevnetModeEnabled()) {
      throw new ServiceUnavailableException(
        'Sports Pack Gacha rip commitments are disabled outside explicit fixture, preview, or devnet mode',
      );
    }
    const machineKey = requireKey(machineKeyInput, 'machineKey');
    const { snapshot } = await this.ensureMachineReadiness(machineKey);
    if (!snapshot.sealedAt) {
      throw new ServiceUnavailableException('Gacha inventory snapshot is not sealed');
    }
    const rules = validateGachaPullOddsRuleSet(
      createFixtureGachaPullOddsRuleSet(snapshot.contentHash),
    );
    const serverSeed = requireServerSeed(randomBytes(32).toString('hex'));
    const committedAt = new Date();
    const expiresAt = new Date(committedAt.getTime() + GACHA_SEED_COMMITMENT_TTL_MS);
    const commitmentId = createId('gachaseed');
    const rgsCommitment = createRgsSeedCommitment({
      commitmentId,
      configHash: snapshot.contentHash,
      mode: 'gacha',
      rulesHash: rules.rulesHash,
      serverSeed,
    });

    await this.database.gachaRipSeedCommitment.create({
      data: {
        committedAt,
        configHash: rgsCommitment.configHash,
        expiresAt,
        id: commitmentId,
        machineKey,
        rgsCommitmentHash: rgsCommitment.commitmentHash,
        rulesHash: rgsCommitment.rulesHash,
        serverSeed,
        serverSeedHash: rgsCommitment.serverSeedHash,
      },
    });

    return {
      commitmentId,
      configHash: rgsCommitment.configHash,
      contractVersion: rgsCommitment.contractVersion,
      expiresAt,
      proofKind: rgsCommitment.proofKind,
      rgsCommitmentHash: rgsCommitment.commitmentHash,
      rulesHash: rgsCommitment.rulesHash,
      serverSeedHash: rgsCommitment.serverSeedHash,
    };
  }

  async createFixtureRip(input: CreateFixtureGachaRipInput) {
    if (!gachaFixtureModeEnabled() && !gachaDevnetModeEnabled()) {
      throw new ServiceUnavailableException(
        'Sports Pack Gacha rips are disabled outside explicit fixture, preview, or devnet mode',
      );
    }
    const machineKey = requireKey(input.machineKey, 'machineKey');
    const recipientWallet = requireReference(input.recipientWallet, 'recipientWallet');
    const clientSeed = requireSeed(input.seed);
    const commitmentId = requireReference(input.commitmentId, 'commitmentId');
    const idempotencyKey = optionalReference(input.idempotencyKey, 'idempotencyKey');
    const requiresPayment = gachaRipRequiresPayment();
    // Fixture mode is deliberately unfunded. Ignore the field completely there
    // so a client carrying devnet state across a preview-mode switch cannot
    // accidentally consume a real verified intent.
    const paymentIntentId = requiresPayment
      ? optionalReference(input.paymentIntentId, 'paymentIntentId')
      : null;
    if (requiresPayment && !paymentIntentId) {
      throw new ConflictException('Gacha rip requires a verified payment intent');
    }
    const oddsVersion = requirePositiveInteger(input.oddsVersion ?? 1, 'oddsVersion');
    const { snapshot } = await this.ensureMachineReadiness(machineKey);
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
        await acquireNamespacedAdvisoryTransactionLock(
          transaction,
          oddsKey,
          GACHA_ODDS_LOCK_NAMESPACE,
        );

        if (paymentIntentId) {
          const fundedRipId = await this.payments.findConsumedRip(transaction, {
            intentId: paymentIntentId,
            machineKey,
            payerWallet: recipientWallet,
          });
          if (fundedRipId) return { kind: 'existing', ripId: fundedRipId };
        }

        if (idempotencyKey) {
          const existing = await transaction.gachaRip.findFirst({
            where: { idempotencyKey, machineKey },
          });
          if (existing) {
            if (!existing.recipientWallet || existing.recipientWallet !== recipientWallet) {
              throw new ConflictException('Gacha rip replay changed its recipient wallet');
            }
            return { kind: 'existing', ripId: existing.id };
          }
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
        const rgsCommitment = createRgsSeedCommitment({
          commitmentId,
          configHash: snapshot.contentHash,
          mode: 'gacha',
          rulesHash: rules.rulesHash,
          serverSeed: seedCommitment.serverSeed,
        });
        if (
          seedCommitment.configHash !== snapshot.contentHash ||
          seedCommitment.rulesHash !== rules.rulesHash ||
          seedCommitment.rgsCommitmentHash !== rgsCommitment.commitmentHash
        ) {
          throw new ConflictException(
            'Gacha rip seed commitment does not match the sealed RGS configuration',
          );
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
            recipientWallet,
            seedCommitmentHash,
            selectedAssetReference: selected.assetReference,
            selectedAt,
            snapshotContentHash: snapshot.contentHash,
            status: GachaRipStatus.SELECTED,
          },
        });

        // Consumed after the rip row exists because `GachaRipPayment.consumedByRipId`
        // is a real foreign key to `GachaRip`, and inside this advisory-locked
        // transaction so a single verified intent can never fund two rips. Note the
        // payment stays CONSUMED if the provider fails after commit and the asset
        // returns to the pool — refunding that is an operator action, not a rollback.
        if (paymentIntentId) {
          await this.payments.consumeVerifiedPayment(transaction, {
            intentId: paymentIntentId,
            machineKey,
            now: selectedAt,
            // Single-player: whoever paid is whoever receives the card.
            payerWallet: recipientWallet,
            ripId,
          });
        }

        const consumed = await transaction.gachaRipSeedCommitment.updateMany({
          data: { clientSeed, consumedByRipId: ripId },
          where: { consumedByRipId: null, expiresAt: { gt: selectedAt }, id: commitmentId },
        });
        if (consumed.count !== 1) {
          throw new ConflictException('Gacha rip seed commitment could not be consumed');
        }

        return { kind: 'created', ripId };
      },
    );

    await this.resumeRipLifecycle(outcome.ripId);
    return this.loadRipResult(outcome.ripId);
  }

  async findRgsProof(ripIdInput: string): Promise<RgsSeededProof> {
    const rip = await this.requireRip(requireReference(ripIdInput, 'ripId'));
    const proof = rgsProofForRip(rip, await this.revealSeedCommitment(rip));
    if (!proof) {
      throw new ConflictException('Gacha RGS proof is unavailable until the rip is terminal');
    }
    return proof;
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
    await this.snapshots.createFixtureSnapshot(snapshotInputForMode(machine, candidates));
    return this.snapshots.findLatestSealed(machineKey);
  }

  private clearBootstrapRetry(): void {
    if (!this.#bootstrapRetry) return;
    clearTimeout(this.#bootstrapRetry);
    this.#bootstrapRetry = undefined;
  }

  private scheduleBootstrapRetry(): void {
    if (this.#bootstrapRetry) return;
    this.#bootstrapRetry = setTimeout(() => {
      this.#bootstrapRetry = undefined;
      void this.bootstrapConfiguredMachines();
    }, gachaBootstrapRetryMs());
    this.#bootstrapRetry.unref?.();
  }

  private async requireCommittedOdds(machineKey: string) {
    const commitment = await this.database.gachaPullOddsCommitment.findFirst({
      orderBy: [{ version: 'desc' }, { committedAt: 'desc' }],
      where: { machineKey, sealedAt: { not: null } },
    });
    if (!commitment) {
      throw new ServiceUnavailableException('No sealed Gacha odds commitment is available');
    }
    return commitment;
  }

  /**
   * Seal the deterministic public read model during controlled bootstrap.
   *
   * Inventory and odds are prerequisites for pricing, but the original lazy
   * path created inventory on seed commitment and odds only after a paid rip.
   * That left both public reads returning 503 on a clean deployment and made
   * the first rip impossible.
   *
   * The first sealed odds commitment selects the canonical snapshot. A second
   * process may have prepared a different timestamped snapshot concurrently,
   * so the odds lock re-reads the winner and every caller returns the exact
   * snapshot named by that commitment.
   */
  private async ensureMachineReadiness(machineKeyInput: string) {
    if (!gachaFixtureModeEnabled() && !gachaDevnetModeEnabled()) {
      throw new ServiceUnavailableException(
        'Sports Pack Gacha machine reads are disabled outside explicit fixture, preview, or devnet mode',
      );
    }
    const machineKey = requireKey(machineKeyInput, 'machineKey');
    const existingOdds = await this.database.gachaPullOddsCommitment.findFirst({
      orderBy: [{ version: 'desc' }, { committedAt: 'desc' }],
      where: { machineKey, sealedAt: { not: null } },
    });
    if (existingOdds) {
      return {
        oddsCommitment: existingOdds,
        snapshot: await this.snapshots.findSealed(machineKey, existingOdds.snapshotContentHash),
      };
    }

    const candidateSnapshot = await this.ensureFixtureSnapshot(machineKey);
    if (!candidateSnapshot.sealedAt) {
      throw new ServiceUnavailableException('Gacha inventory snapshot is not sealed');
    }
    const rules = validateGachaPullOddsRuleSet(
      createFixtureGachaPullOddsRuleSet(candidateSnapshot.contentHash),
    );
    const oddsKey = `${machineKey}:fixture-odds`;
    const committedAt = new Date();
    const oddsCommitment = await this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        oddsKey,
        GACHA_ODDS_LOCK_NAMESPACE,
      );
      const winner = await transaction.gachaPullOddsCommitment.findFirst({
        orderBy: [{ version: 'desc' }, { committedAt: 'desc' }],
        where: { machineKey, sealedAt: { not: null } },
      });
      if (winner) return winner;
      return ensureOddsCommitment(transaction, machineKey, oddsKey, 1, rules, committedAt);
    });
    return {
      oddsCommitment,
      snapshot: await this.snapshots.findSealed(machineKey, oddsCommitment.snapshotContentHash),
    };
  }

  /**
   * Resume the post-commit provider lifecycle under a renewable database lease.
   *
   * The payment and seed commit before provider I/O, so a process may disappear
   * with the rip still SELECTED/REVEALED/ACQUIRED. Both the HTTP idempotency key
   * and the consumed payment relation route a retry back here. The lease prevents
   * ordinary concurrent retries; after a crashed owner expires, the next retry
   * safely repeats deterministic, rip-keyed provider operations.
   */
  private async resumeRipLifecycle(ripId: string): Promise<void> {
    const leaseOwner = randomUUID();
    const now = new Date();
    const claimed = await this.database.gachaRip.updateMany({
      data: {
        lifecycleLeaseExpiresAt: leaseExpiry(now),
        lifecycleLeaseOwner: leaseOwner,
      },
      where: {
        id: ripId,
        status: { in: [...INCOMPLETE_RIP_STATUSES] },
        OR: [
          { lifecycleLeaseOwner: null },
          { lifecycleLeaseExpiresAt: null },
          { lifecycleLeaseExpiresAt: { lte: now } },
        ],
      },
    });
    if (claimed.count !== 1) {
      const current = await this.requireRip(ripId);
      if (current.status === GachaRipStatus.SETTLED || current.status === GachaRipStatus.FAILED) {
        return;
      }
      throw new ConflictException('Gacha rip lifecycle recovery is already in progress');
    }

    try {
      let current = await this.requireRip(ripId);

      if (current.status === GachaRipStatus.SELECTED) {
        await this.advanceLeasedRip(ripId, leaseOwner, GachaRipStatus.SELECTED, {
          revealedAt: new Date(),
          status: GachaRipStatus.REVEALED,
        });
        current = await this.requireRip(ripId);
      }

      if (current.status === GachaRipStatus.REVEALED) {
        if (!current.recipientWallet || !current.selectedAssetReference) {
          throw new ServiceUnavailableException('Gacha rip recovery evidence is incomplete');
        }
        let acquired: Awaited<ReturnType<SportsPackGachaProvider['acquireCard']>>;
        try {
          acquired = await this.provider.acquireCard({
            assetReference: current.selectedAssetReference,
            recipientWallet: current.recipientWallet,
            ripId,
          });
        } catch (error) {
          // Only an explicit provider proof that delivery did not happen can
          // release inventory. Ordinary exceptions include timeouts after a
          // provider-side success, so the outer catch preserves REVEALED and
          // clears the lease for an idempotent retry/reconciliation instead.
          if (error instanceof GachaCardDefinitelyNotAcquiredError) {
            await this.failLeasedRip(ripId, leaseOwner, error).catch(() => undefined);
          }
          throw error;
        }
        await this.advanceLeasedRip(ripId, leaseOwner, GachaRipStatus.REVEALED, {
          acquiredAt: new Date(),
          acquisitionReference: acquired.acquisitionReference,
          status: GachaRipStatus.ACQUIRED,
        });
        current = await this.requireRip(ripId);
      }

      if (current.status === GachaRipStatus.ACQUIRED) {
        if (!current.acquisitionReference) {
          throw new ServiceUnavailableException('Gacha rip acquisition evidence is incomplete');
        }
        const settled = await this.provider.settleRip({
          acquisitionReference: current.acquisitionReference,
          ripId,
        });
        await this.advanceLeasedRip(ripId, leaseOwner, GachaRipStatus.ACQUIRED, {
          lifecycleLeaseExpiresAt: null,
          lifecycleLeaseOwner: null,
          settledAt: new Date(),
          settlementReference: settled.settlementReference,
          status: GachaRipStatus.SETTLED,
        });
      }
    } catch (error) {
      // Do not terminally fail an ambiguous provider/DB boundary. Clearing the
      // lease lets the same rip-keyed idempotent operation resume immediately;
      // if the database is unavailable, the bounded lease expires on its own.
      await this.releaseLifecycleLease(ripId, leaseOwner).catch(() => undefined);
      throw error;
    }
  }

  private async advanceLeasedRip(
    ripId: string,
    leaseOwner: string,
    expectedStatus: GachaRipStatus,
    data: {
      acquiredAt?: Date;
      acquisitionReference?: string;
      lifecycleLeaseExpiresAt?: Date | null;
      lifecycleLeaseOwner?: string | null;
      revealedAt?: Date;
      settledAt?: Date;
      settlementReference?: string;
      status: GachaRipStatus;
    },
  ): Promise<void> {
    const updated = await this.database.gachaRip.updateMany({
      data: {
        ...data,
        ...(data.status === GachaRipStatus.SETTLED
          ? {}
          : { lifecycleLeaseExpiresAt: leaseExpiry(new Date()) }),
      },
      where: { id: ripId, lifecycleLeaseOwner: leaseOwner, status: expectedStatus },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Gacha rip lifecycle lease was lost');
    }
  }

  private async failLeasedRip(ripId: string, leaseOwner: string, error: unknown): Promise<void> {
    const current = await this.requireRip(ripId);
    if (
      !INCOMPLETE_RIP_STATUSES.includes(
        current.status as (typeof INCOMPLETE_RIP_STATUSES)[number],
      ) ||
      current.lifecycleLeaseOwner !== leaseOwner
    ) {
      return;
    }
    await this.database.gachaRip.updateMany({
      data: {
        failedAssetReference: current.selectedAssetReference,
        failedAt: new Date(),
        failureReason: error instanceof Error ? error.message.slice(0, 240) : 'Unknown failure',
        lifecycleLeaseExpiresAt: null,
        lifecycleLeaseOwner: null,
        selectedAssetReference: null,
        status: GachaRipStatus.FAILED,
      },
      where: {
        id: ripId,
        lifecycleLeaseOwner: leaseOwner,
        status: current.status,
      },
    });
  }

  private async releaseLifecycleLease(ripId: string, leaseOwner: string): Promise<void> {
    await this.database.gachaRip.updateMany({
      data: { lifecycleLeaseExpiresAt: null, lifecycleLeaseOwner: null },
      where: {
        id: ripId,
        lifecycleLeaseOwner: leaseOwner,
        status: { in: [...INCOMPLETE_RIP_STATUSES] },
      },
    });
  }

  private async requireRip(ripId: string) {
    const rip = await this.database.gachaRip.findUnique({ where: { id: ripId } });
    if (!rip) throw new ServiceUnavailableException('Gacha rip could not be reloaded');
    return rip;
  }

  private async loadRipResult(ripId: string) {
    const rip = await this.requireRip(ripId);
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
      rip: publicRip(rip),
      rgsProof: rgsProofForRip(rip, revealed),
      serverSeed: revealed.serverSeed,
      serverSeedHash: revealed.serverSeedHash,
    };
  }

  private async revealSeedCommitment(rip: { id: string; status: GachaRipStatus }): Promise<{
    clientSeed: string | null;
    commitmentId: string | null;
    configHash: string | null;
    rgsCommitmentHash: string | null;
    rulesHash: string | null;
    serverSeed: string | null;
    serverSeedHash: string | null;
  }> {
    if (rip.status !== GachaRipStatus.SETTLED && rip.status !== GachaRipStatus.FAILED) {
      return {
        clientSeed: null,
        commitmentId: null,
        configHash: null,
        rgsCommitmentHash: null,
        rulesHash: null,
        serverSeed: null,
        serverSeedHash: null,
      };
    }
    const commitment = await this.database.gachaRipSeedCommitment.findUnique({
      where: { consumedByRipId: rip.id },
    });
    if (!commitment) {
      return {
        clientSeed: null,
        commitmentId: null,
        configHash: null,
        rgsCommitmentHash: null,
        rulesHash: null,
        serverSeed: null,
        serverSeedHash: null,
      };
    }
    return {
      clientSeed: commitment.clientSeed,
      commitmentId: commitment.id,
      configHash: commitment.configHash,
      rgsCommitmentHash: commitment.rgsCommitmentHash,
      rulesHash: commitment.rulesHash,
      serverSeed: commitment.serverSeed,
      serverSeedHash: commitment.serverSeedHash,
    };
  }
}

function gachaBootstrapRetryMs(environment: NodeJS.ProcessEnv = process.env): number {
  return environment.NODE_ENV === 'test' ? 1 : GACHA_BOOTSTRAP_RETRY_MS;
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + GACHA_RIP_LIFECYCLE_LEASE_MS);
}

function publicRip(rip: GachaRipRow) {
  return {
    acquiredAt: rip.acquiredAt,
    acquisitionReference: rip.acquisitionReference,
    createdAt: rip.createdAt,
    failedAssetReference: rip.failedAssetReference,
    failedAt: rip.failedAt,
    failureReason: rip.failureReason,
    id: rip.id,
    idempotencyKey: rip.idempotencyKey,
    insuredValueCurrency: rip.insuredValueCurrency,
    insuredValueDecimals: rip.insuredValueDecimals,
    insuredValueMinor: rip.insuredValueMinor,
    machineKey: rip.machineKey,
    oddsCommitmentId: rip.oddsCommitmentId,
    oddsRulesHash: rip.oddsRulesHash,
    rarity: rarityForSerializedValue(rip.insuredValueMinor, rip.insuredValueDecimals),
    revealedAt: rip.revealedAt,
    seedCommitmentHash: rip.seedCommitmentHash,
    selectedAssetReference: rip.selectedAssetReference,
    selectedAt: rip.selectedAt,
    settledAt: rip.settledAt,
    settlementReference: rip.settlementReference,
    snapshotContentHash: rip.snapshotContentHash,
    status: rip.status,
    updatedAt: rip.updatedAt,
  };
}

function rgsProofForRip(
  rip: GachaRipRow,
  reveal: {
    clientSeed: string | null;
    commitmentId: string | null;
    configHash: string | null;
    rgsCommitmentHash: string | null;
    rulesHash: string | null;
    serverSeed: string | null;
    serverSeedHash: string | null;
  },
): RgsSeededProof | null {
  if (
    !reveal.clientSeed ||
    !reveal.commitmentId ||
    !reveal.configHash ||
    !reveal.rgsCommitmentHash ||
    !reveal.rulesHash ||
    !reveal.serverSeed ||
    !reveal.serverSeedHash
  ) {
    return null;
  }
  const proof = createRgsSeededProof({
    clientSeed: reveal.clientSeed,
    commitmentId: reveal.commitmentId,
    configHash: reveal.configHash,
    mode: 'gacha',
    phase: rip.status === GachaRipStatus.SETTLED ? 'settled' : 'revealed',
    result: {
      assetReference: rip.selectedAssetReference ?? rip.failedAssetReference,
      insuredValueCurrency: rip.insuredValueCurrency,
      insuredValueDecimals: rip.insuredValueDecimals,
      insuredValueMinor: rip.insuredValueMinor,
      status: rip.status,
    },
    roundId: rip.id,
    rulesHash: reveal.rulesHash,
    serverSeed: reveal.serverSeed,
  });
  if (
    proof.commitmentHash !== reveal.rgsCommitmentHash ||
    proof.serverSeedHash !== reveal.serverSeedHash
  ) {
    throw new ServiceUnavailableException('Gacha RGS proof does not match its commitment');
  }
  return proof;
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

  const digest = Buffer.from(
    deriveRgsSeededEntropy({
      clientSeed: requireSeed(seeds.clientSeed),
      configHash: rules.snapshotContentHash,
      rulesHash: rules.rulesHash,
      serverSeed: requireServerSeed(seeds.serverSeed),
    }),
    'hex',
  );
  const rollPpm = digest.readUInt32BE(0) % 1_000_000;
  const band = gachaPullOddsBandForRoll(rules.bands, rollPpm);
  const candidates = eligible.filter(
    (entry) => gachaPullOddsBandForValue(rules.bands, entry.insuredValueMinor).label === band.label,
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
