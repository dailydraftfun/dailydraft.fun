import { BadGatewayException, ConflictException, Injectable } from '@nestjs/common';

import type { Duel } from '../domain.js';
import type { DuelSide, ProviderPackSnapshot } from '../providers/pack-provider.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { PackProviderService } from '../providers/pack-provider.service.js';
import { compareInsuredValues, normalizeProviderResult } from '../providers/provider-result.js';
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
  ) {}

  async open(duelId: string, idempotencyKey: string): Promise<Duel> {
    let duel = await this.duels.findOne(duelId);
    if (duel.result?.resultHash && ['awaiting_assets', 'refunding'].includes(duel.status)) {
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
    const [creator, opponent] = await Promise.all([
      this.openSide(duel, 'creator', provider, providerPackId, escrowAddress),
      this.openSide(duel, 'opponent', provider, providerPackId, escrowAddress),
    ]);
    const comparison = compareInsuredValues(creator, opponent, {
      creatorWallet: duel.creatorWallet,
      duelId,
      escrowAddress,
      network: duel.environment,
      opponentWallet,
      providerMode: duel.providerMode,
    });

    return this.repository.resolveOpenedPacks({
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
  }

  private async openSide(
    duel: Duel,
    side: DuelSide,
    provider: ReturnType<PackProviderService['forDuel']>,
    providerPackId: string,
    recipientWallet: string,
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
    const result = requireOpenedResult(snapshot);
    return {
      ...normalizeProviderResult(side, result),
      providerReference: snapshot.providerReference,
    };
  }
}

function requireOpenedResult(snapshot: ProviderPackSnapshot) {
  if (snapshot.status === 'failed') {
    throw new BadGatewayException('Pack provider could not open a pack');
  }
  if (snapshot.status !== 'opened') {
    throw new ConflictException(`Pack provider result is ${snapshot.status}`);
  }
  return snapshot.result;
}
