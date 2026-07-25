import { DuelProviderOperationStatus } from '@dailydraft/db';
import { BadGatewayException, ConflictException, Injectable, Optional } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AdminService } from '../admin/admin.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AnalyticsService } from '../analytics/analytics.service.js';
import type { Duel } from '../domain.js';
import type {
  OpenedProviderPackSnapshot,
  ProviderPackSnapshot,
} from '../providers/pack-provider.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { PackProviderService } from '../providers/pack-provider.service.js';
import { compareInsuredValues, normalizeProviderResult } from '../providers/provider-result.js';
import { requireCanonicalValuationPolicyHash } from '../providers/valuation-policy.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DevnetDemoSettlementService } from '../transactions/devnet-demo-settlement.service.js';
// biome-ignore lint/style/useImportType: Nest uses the repository class as a runtime injection token.
import { DuelRepository } from './duel.repository.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DuelsService } from './duels.service.js';
import { hashDuelRequest } from './prisma-duel.repository.js';
// biome-ignore lint/style/useImportType: Nest uses the repository class as a runtime injection token.
import {
  type ProviderOpeningOperation,
  ProviderOpeningRepository,
} from './provider-opening.repository.js';

@Injectable()
export class DuelOpeningService {
  constructor(
    private readonly duels: DuelsService,
    private readonly repository: DuelRepository,
    private readonly providers: PackProviderService,
    private readonly providerOperations: ProviderOpeningRepository,
    @Optional() private readonly devnetSettlement?: DevnetDemoSettlementService,
    @Optional() private readonly analytics?: AnalyticsService,
    @Optional() private readonly admin?: AdminService,
  ) {}

  async open(duelId: string, idempotencyKey: string): Promise<Duel> {
    let duel = await this.duels.findOne(duelId);
    if (!houseLifecycleMayContinueDuringPause(duel)) {
      await this.admin?.assertNotPaused();
    }
    if (
      duel.result?.resultHash &&
      ['awaiting_assets', 'settling', 'refunding'].includes(duel.status)
    ) {
      if (
        duel.providerMode === 'dailydraft-devnet' &&
        ['awaiting_assets', 'settling', 'refunding'].includes(duel.status)
      ) {
        await this.requireDevnetSettlement().finalizeDuel(duel.id);
        return this.duels.findOne(duel.id);
      }
      return duel;
    }
    if (!['funded', 'opening'].includes(duel.status)) {
      throw new ConflictException(`Duel packs cannot open from ${duel.status}`);
    }
    const opponentWallet = duel.opponentWallet;
    if (!opponentWallet) throw new ConflictException('Duel has no committed opponent');
    const escrowAddress = duel.escrowAddress;
    if (!escrowAddress) {
      throw new ConflictException('Duel escrow must be confirmed before packs can open');
    }
    const providerPackId = duel.pack.providerPackId;
    if (!providerPackId) {
      throw new ConflictException('Duel pack has no provider pack mapping');
    }
    const valuationPolicyHash = requireCanonicalValuationPolicyHash(duel.pack.valuationPolicyHash);
    const provider = this.providers.forDuel(duel);

    if (duel.status === 'funded') {
      duel = await this.repository.transition({
        data: { providerMode: duel.providerMode },
        duelId,
        eventType: 'duel.pack_opening_started',
        idempotencyKey: `${idempotencyKey}:opening`,
        requestHash: hashDuelRequest({ duelId, step: 'opening' }),
        toStatus: 'opening',
      });
    }
    if (duel.status !== 'opening') {
      throw new ConflictException(`Duel packs cannot open from ${duel.status}`);
    }
    const tier = Number(duel.stake.amount) / 10 ** duel.stake.decimals;
    const operations = await this.providerOperations.reservePair([
      providerOperationReservation(
        duel.id,
        'creator',
        provider.mode,
        providerPackId,
        escrowAddress,
      ),
      providerOperationReservation(
        duel.id,
        'opponent',
        provider.mode,
        providerPackId,
        escrowAddress,
      ),
    ]);
    const creatorOperation = requireSideOperation(operations, 'creator');
    const opponentOperation = requireSideOperation(operations, 'opponent');
    const [creator, opponent] = await Promise.all([
      this.openSide(provider, creatorOperation, valuationPolicyHash),
      this.openSide(provider, opponentOperation, valuationPolicyHash),
    ]).catch(async (error: unknown) => {
      await this.analytics?.recordServer({
        duelId,
        mode: duel.matchmakingMode,
        name: 'provider_error',
        status: 'failed',
        tier,
      });
      throw error;
    });
    await this.analytics?.recordServer({
      duelId,
      mode: duel.matchmakingMode,
      name: 'pack_reveal_started',
      status: 'opening',
      tier,
    });
    const comparison = compareInsuredValues(creator, opponent, {
      creatorWallet: duel.creatorWallet,
      duelId,
      escrowAddress,
      network: duel.environment,
      opponentWallet,
      providerMode: duel.providerMode,
      valuationPolicyHash,
    });

    const resolved = await this.repository.resolveOpenedPacks({
      comparison,
      creator,
      duelId,
      idempotencyKey: `${idempotencyKey}:results`,
      isMock: provider.mode === 'mock',
      opponent,
      provider: provider.mode,
      requestHash: hashDuelRequest({
        comparison,
        creatorResultHash: creator.resultHash,
        duelId,
        opponentResultHash: opponent.resultHash,
      }),
    });
    await this.analytics?.recordServer({
      duelId,
      mode: duel.matchmakingMode,
      name: 'pack_revealed',
      status: resolved.status,
      tier,
    });
    if (resolved.providerMode === 'dailydraft-devnet') {
      await this.requireDevnetSettlement().finalizeDuel(resolved.id);
      return this.duels.findOne(resolved.id);
    }
    return resolved;
  }

  private async openSide(
    provider: ReturnType<PackProviderService['forDuel']>,
    operation: ProviderOpeningOperation,
    valuationPolicyHash: string,
  ) {
    if (operation.normalizedOutcome) return operation.normalizedOutcome;
    let current = operation;
    try {
      if (!current.providerReference) {
        const generated = await provider.generatePack({
          duelId: current.duelId,
          idempotencyKey: current.generateIdempotencyKey,
          providerPackId: current.providerPackId,
          recipientWallet: current.recipientWallet,
          side: current.side,
        });
        current = await this.providerOperations.recordGenerated(
          current.id,
          generated.providerReference,
        );
      }
      const providerReference = current.providerReference;
      if (!providerReference) {
        throw new ConflictException('Provider operation has no committed reference');
      }

      if (
        current.status === DuelProviderOperationStatus.OPENING ||
        current.status === DuelProviderOperationStatus.RECOVERY_REQUIRED
      ) {
        const recovered = await provider.getPack(providerReference);
        if (recovered.status === 'opened') {
          return this.persistOpened(provider, current, recovered, valuationPolicyHash);
        }
        if (recovered.status === 'failed') {
          throw new BadGatewayException('Pack provider could not recover a pack');
        }
      }

      current = await this.providerOperations.markOpening(current.id);
      const requested = await provider.openPack({
        idempotencyKey: current.openIdempotencyKey,
        providerReference,
      });
      const snapshot =
        requested.status === 'opened' ? requested : await provider.getPack(providerReference);
      const opened = requireOpenedSnapshot(snapshot);
      return this.persistOpened(provider, current, opened, valuationPolicyHash);
    } catch (error) {
      await this.providerOperations
        .markRecovery(current.id, providerRecoveryCode(error))
        .catch(() => undefined);
      throw error;
    }
  }

  private async persistOpened(
    provider: ReturnType<PackProviderService['forDuel']>,
    operation: ProviderOpeningOperation,
    opened: OpenedProviderPackSnapshot,
    valuationPolicyHash: string,
  ) {
    provider.verifyOpenedSnapshot(opened);
    const normalized = normalizeProviderResult(
      operation.side,
      opened.result,
      valuationPolicyHash,
      opened.providerReference,
      new Date(opened.openedAt),
    );
    const persisted = await this.providerOperations.recordOpened({
      evidence: opened.evidence,
      normalizedOutcome: normalized,
      operationId: operation.id,
      providerReference: opened.providerReference,
    });
    if (!persisted.normalizedOutcome) {
      throw new ConflictException('Provider result evidence was not persisted');
    }
    return persisted.normalizedOutcome;
  }

  private requireDevnetSettlement(): DevnetDemoSettlementService {
    if (!this.devnetSettlement) {
      throw new ConflictException('DailyDraft devnet settlement is not configured');
    }
    return this.devnetSettlement;
  }
}

function providerOperationReservation(
  duelId: string,
  side: 'creator' | 'opponent',
  provider: string,
  providerPackId: string,
  recipientWallet: string,
) {
  const operationKey = `${duelId}:${side}`;
  return {
    duelId,
    generateIdempotencyKey: `${operationKey}:generate`,
    openIdempotencyKey: `${operationKey}:open`,
    provider,
    providerPackId,
    recipientWallet,
    side,
  };
}

function requireSideOperation(
  operations: readonly ProviderOpeningOperation[],
  side: 'creator' | 'opponent',
): ProviderOpeningOperation {
  const operation = operations.find((candidate) => candidate.side === side);
  if (!operation) throw new ConflictException(`Provider operation for ${side} is unavailable`);
  return operation;
}

function providerRecoveryCode(error: unknown): string {
  if (error instanceof BadGatewayException) return 'provider_failed_or_invalid';
  if (error instanceof ConflictException) return 'provider_pending_or_conflicted';
  return 'provider_operation_ambiguous';
}

function houseLifecycleMayContinueDuringPause(duel: Duel): boolean {
  return (
    duel.houseOpponent &&
    ['funded', 'opening', 'awaiting_assets', 'settling', 'refunding'].includes(duel.status)
  );
}

function requireOpenedSnapshot(
  snapshot: ProviderPackSnapshot,
): Extract<ProviderPackSnapshot, { status: 'opened' }> {
  if (snapshot.status === 'failed') {
    throw new BadGatewayException('Pack provider could not open a pack');
  }
  if (snapshot.status !== 'opened') {
    throw new ConflictException(`Pack provider result is ${snapshot.status}`);
  }
  return snapshot;
}
