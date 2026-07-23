import { BadGatewayException, ConflictException, Injectable, Optional } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AdminService } from '../admin/admin.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AnalyticsService } from '../analytics/analytics.service.js';
import type { Duel } from '../domain.js';
import type { DuelSide, ProviderPackSnapshot } from '../providers/pack-provider.js';
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

@Injectable()
export class DuelOpeningService {
  constructor(
    private readonly duels: DuelsService,
    private readonly repository: DuelRepository,
    private readonly providers: PackProviderService,
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
        duel.providerMode === 'openpacksduel-devnet' &&
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
    await this.analytics?.recordServer({
      duelId,
      mode: duel.matchmakingMode,
      name: 'pack_reveal_started',
      status: 'opening',
      tier,
    });
    const [creator, opponent] = await Promise.all([
      this.openSide(duel, 'creator', provider, providerPackId, escrowAddress, valuationPolicyHash),
      this.openSide(duel, 'opponent', provider, providerPackId, escrowAddress, valuationPolicyHash),
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
    if (resolved.providerMode === 'openpacksduel-devnet') {
      await this.requireDevnetSettlement().finalizeDuel(resolved.id);
      return this.duels.findOne(resolved.id);
    }
    return resolved;
  }

  private async openSide(
    duel: Duel,
    side: DuelSide,
    provider: ReturnType<PackProviderService['forDuel']>,
    providerPackId: string,
    recipientWallet: string,
    valuationPolicyHash: string,
  ) {
    const providerOperationKey = `${duel.id}:${side}`;
    const generated = await provider.generatePack({
      duelId: duel.id,
      idempotencyKey: `${providerOperationKey}:generate`,
      providerPackId,
      recipientWallet,
      side,
    });
    await provider.openPack({
      idempotencyKey: `${providerOperationKey}:open`,
      providerReference: generated.providerReference,
    });
    const snapshot = await provider.getPack(generated.providerReference);
    const opened = requireOpenedSnapshot(snapshot);
    return normalizeProviderResult(
      side,
      opened.result,
      valuationPolicyHash,
      opened.providerReference,
      new Date(opened.openedAt),
    );
  }

  private requireDevnetSettlement(): DevnetDemoSettlementService {
    if (!this.devnetSettlement) {
      throw new ConflictException('OpenPacks devnet settlement is not configured');
    }
    return this.devnetSettlement;
  }
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
