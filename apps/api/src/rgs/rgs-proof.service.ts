import {
  createRgsExternalProof,
  type RgsExternalProof,
  type RgsJsonValue,
  type RgsMode,
  type RgsModeConfig,
  type RgsProof,
  rgsCompatibilityFixtures,
  verifyRgsProof,
} from '@dailydraft/contracts';
import { type DatabaseClient, DuelSide, type Prisma } from '@dailydraft/db';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GachaRipService } from '../gacha/gacha-rip.service.js';
import { createDuelRgsCommitment } from './rgs-duel-contract.js';

const ROUND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const RGS_MODES = new Set<RgsMode>(['crash', 'duel', 'flip', 'gacha']);

export type DuelRgsProofCandidate = Prisma.DuelGetPayload<{
  include: {
    packOutcomes: true;
    providerOperations: true;
  };
}>;

@Injectable()
export class RgsProofService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly gachaRips: GachaRipService,
  ) {}

  listModes(): readonly RgsModeConfig[] {
    return Object.values(rgsCompatibilityFixtures.modes);
  }

  async findRoundProof(modeInput: string, roundIdInput: string): Promise<RgsProof> {
    const mode = requireMode(modeInput);
    const roundId = requireRoundId(roundIdInput);
    if (mode === 'gacha') return this.gachaRips.findRgsProof(roundId);
    if (mode === 'duel') return this.findDuelProof(roundId);
    throw new ConflictException(`${mode} RGS rounds are fixture-only and cannot emit live proofs`);
  }

  verify(proof: RgsProof) {
    return verifyRgsProof(proof);
  }

  private async findDuelProof(duelId: string): Promise<RgsExternalProof> {
    const duel = await this.database.duel.findUnique({
      include: {
        packOutcomes: true,
        providerOperations: true,
      },
      where: { id: duelId },
    });
    if (!duel) throw new NotFoundException('Duel RGS round was not found');
    return buildDuelRgsProof(duel);
  }
}

export function buildDuelRgsProof(duel: DuelRgsProofCandidate): RgsExternalProof {
  if (
    !duel.resultHash ||
    !duel.resultReadyAt ||
    !duel.rgsCommitmentHash ||
    !duel.rgsConfigHash ||
    !duel.rgsRulesHash ||
    !duel.valuationPolicyHash ||
    duel.packOutcomes.length !== 2 ||
    duel.providerOperations.length !== 2
  ) {
    throw new ConflictException('Duel RGS proof is unavailable until both packs are revealed');
  }

  const operations = [...duel.providerOperations].sort((left, right) =>
    left.side.localeCompare(right.side),
  );
  const outcomes = [...duel.packOutcomes].sort((left, right) =>
    left.side.localeCompare(right.side),
  );
  if (
    operations.some(
      (operation) =>
        !operation.payloadHash ||
        !operation.providerReference ||
        !operation.resultHash ||
        !operation.signature ||
        !operation.signatureAlgorithm ||
        !operation.signingKeyReference,
    )
  ) {
    throw new ServiceUnavailableException('Duel provider proof evidence is incomplete');
  }

  const commitment = createDuelRgsCommitment({
    duelId: duel.id,
    operations,
    packId: duel.packId,
    providerMode: duel.providerMode,
    rulesHash: duel.valuationPolicyHash,
  });
  if (
    commitment.commitmentHash !== duel.rgsCommitmentHash ||
    commitment.configHash !== duel.rgsConfigHash ||
    commitment.rulesHash !== duel.rgsRulesHash
  ) {
    throw new ServiceUnavailableException('Duel RGS commitment is inconsistent');
  }
  const evidence = operations.map((operation) => ({
    payloadHash: operation.payloadHash as string,
    providerReference: operation.providerReference as string,
    resultHash: operation.resultHash as string,
    side: rgsSide(operation.side),
    signature: operation.signature as string,
    signatureAlgorithm: operation.signatureAlgorithm as string,
    signingKeyReference: operation.signingKeyReference as string,
  }));
  const creatorOutcome = outcomes.find((outcome) => outcome.side === DuelSide.CREATOR);
  const opponentOutcome = outcomes.find((outcome) => outcome.side === DuelSide.OPPONENT);
  const creatorOperation = operations.find((operation) => operation.side === DuelSide.CREATOR);
  const opponentOperation = operations.find((operation) => operation.side === DuelSide.OPPONENT);
  if (
    !creatorOutcome ||
    !opponentOutcome ||
    !creatorOperation ||
    !opponentOperation ||
    creatorOutcome.resultHash !== creatorOperation.resultHash ||
    opponentOutcome.resultHash !== opponentOperation.resultHash
  ) {
    throw new ServiceUnavailableException('Duel RGS outcome pair is incomplete');
  }
  const winnerSide =
    duel.winnerWallet === null
      ? null
      : duel.winnerWallet === duel.creatorWallet
        ? 'creator'
        : duel.winnerWallet === duel.opponentWallet
          ? 'opponent'
          : null;
  if (duel.winnerWallet !== null && winnerSide === null) {
    throw new ServiceUnavailableException('Duel RGS winner does not match either participant');
  }

  return createRgsExternalProof({
    configHash: commitment.configHash,
    evidence,
    mode: 'duel',
    phase: duel.settledAt ? 'settled' : 'revealed',
    request: commitment.request,
    result: {
      comparisonHash: duel.resultHash,
      comparisonRecipe: 'dailydraft.insured-value-comparison.v1',
      creatorResultHash: creatorOutcome.resultHash,
      opponentResultHash: opponentOutcome.resultHash,
      winnerSide,
    },
    roundId: duel.id,
    rulesHash: duel.valuationPolicyHash,
  });
}

function requireMode(value: string): RgsMode {
  if (!RGS_MODES.has(value as RgsMode)) {
    throw new BadRequestException('RGS mode is invalid');
  }
  return value as RgsMode;
}

function requireRoundId(value: string): string {
  if (!ROUND_ID_PATTERN.test(value)) {
    throw new BadRequestException('RGS roundId is invalid');
  }
  return value;
}

function rgsSide(side: DuelSide): RgsJsonValue {
  return side === DuelSide.CREATOR ? 'creator' : 'opponent';
}
