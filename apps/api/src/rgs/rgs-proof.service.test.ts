import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { rgsCompatibilityFixtures, verifyRgsProof } from '@dailydraft/contracts';
import type { DatabaseClient } from '@dailydraft/db';
import { DuelSide } from '@dailydraft/db';

import { CRASH_CALCULATOR_VERSION } from '../crash/crash-calculators.js';
import { FLIP_INVENTORY_SCHEMA_VERSION } from '../flip/flip-inventory-snapshot.service.js';
import { GACHA_PULL_ODDS_CALCULATOR_VERSION } from '../gacha/gacha-pull-odds.js';
import type { GachaRipService } from '../gacha/gacha-rip.service.js';
import { createDuelRgsCommitment } from './rgs-duel-contract.js';
import { RgsProofService } from './rgs-proof.service.js';

describe('RgsProofService', () => {
  test('registers Duels, Gacha, Flip, and Crash as guarded versioned configs', () => {
    const service = serviceWith(null);
    const modes = service.listModes();

    expect(modes.map((mode) => mode.mode).sort()).toEqual(['crash', 'duel', 'flip', 'gacha']);
    expect(modes.find((mode) => mode.mode === 'crash')?.calculatorVersion).toBe(
      CRASH_CALCULATOR_VERSION,
    );
    expect(modes.find((mode) => mode.mode === 'flip')?.calculatorVersion).toBe(
      FLIP_INVENTORY_SCHEMA_VERSION,
    );
    expect(modes.find((mode) => mode.mode === 'gacha')?.calculatorVersion).toBe(
      GACHA_PULL_ODDS_CALCULATOR_VERSION,
    );
    expect(modes.every((mode) => mode.realValueGate === 'hitl-required')).toBe(true);
    expect(modes.filter((mode) => ['crash', 'flip'].includes(mode.mode))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ activation: 'fixture-only', mode: 'crash' }),
        expect.objectContaining({ activation: 'fixture-only', mode: 'flip' }),
      ]),
    );
  });

  test('re-expresses a settled Duel provider pair as an independently verifiable proof', async () => {
    const service = serviceWith(duelFixture());

    const proof = await service.findRoundProof('duel', 'duel_rgs_fixture');

    expect(proof).toMatchObject({
      mode: 'duel',
      phase: 'settled',
      proofKind: 'external-provider',
      roundId: 'duel_rgs_fixture',
    });
    expect(verifyRgsProof(proof)).toEqual({ errors: [], valid: true });
    expect(proof.result).toMatchObject({ comparisonHash: 'd'.repeat(64) });
  });

  test('delegates Gacha proof lookup to the existing guarded rip lifecycle', async () => {
    const calls: string[] = [];
    const proof = {
      ...rgsCompatibilityFixtures.seededProof,
      roundId: 'gacharip_fixture',
    };
    const gacha = {
      findRgsProof: async (roundId: string) => {
        calls.push(roundId);
        return proof;
      },
    } as unknown as GachaRipService;
    const database = {
      duel: { findUnique: async () => null },
    } as unknown as DatabaseClient;
    const service = new RgsProofService(database, gacha);

    expect(await service.findRoundProof('gacha', 'gacharip_fixture')).toBe(proof);
    expect(calls).toEqual(['gacharip_fixture']);
  });

  test('fails closed for invalid or fixture-only live round requests', async () => {
    const service = serviceWith(null);

    await expect(service.findRoundProof('unknown', 'round_1')).rejects.toThrow(
      'RGS mode is invalid',
    );
    await expect(service.findRoundProof('crash', 'round_1')).rejects.toThrow(
      'fixture-only and cannot emit live proofs',
    );
    await expect(service.findRoundProof('duel', 'invalid round id')).rejects.toThrow(
      'RGS roundId is invalid',
    );
  });

  test('fails closed for absent, incomplete, drifted, or contradictory Duel proof evidence', async () => {
    await expect(serviceWith(null).findRoundProof('duel', 'duel_missing')).rejects.toThrow(
      'Duel RGS round was not found',
    );
    await expect(
      serviceWith({ ...duelFixture(), resultHash: null }).findRoundProof(
        'duel',
        'duel_rgs_fixture',
      ),
    ).rejects.toThrow('unavailable until both packs are revealed');

    const incompleteEvidence = duelFixture();
    const firstOperation = incompleteEvidence.providerOperations[0];
    if (!firstOperation) throw new Error('Duel fixture must include a creator operation');
    (firstOperation as { payloadHash: string | null }).payloadHash = null;
    await expect(
      serviceWith(incompleteEvidence).findRoundProof('duel', 'duel_rgs_fixture'),
    ).rejects.toThrow('provider proof evidence is incomplete');

    await expect(
      serviceWith({ ...duelFixture(), rgsCommitmentHash: 'f'.repeat(64) }).findRoundProof(
        'duel',
        'duel_rgs_fixture',
      ),
    ).rejects.toThrow('RGS commitment is inconsistent');

    await expect(
      serviceWith({ ...duelFixture(), winnerWallet: 'unknown-wallet' }).findRoundProof(
        'duel',
        'duel_rgs_fixture',
      ),
    ).rejects.toThrow('winner does not match either participant');
  });

  test('migrates RGS commitments without invalidating legacy completed rounds', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260727120000_rgs_round_commitments/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('"rgsCommitmentHash" IS NULL');
    expect(migration).toContain('ADD CONSTRAINT "Duel_rgs_contract_check"');
    expect(migration).toContain('length("clientSeed") BETWEEN 1 AND 240');
  });
});

function serviceWith(duel: unknown): RgsProofService {
  const database = {
    duel: { findUnique: async () => duel },
  } as unknown as DatabaseClient;
  const gacha = {
    findRgsProof: async () => {
      throw new Error('unexpected Gacha proof lookup');
    },
  } as unknown as GachaRipService;
  return new RgsProofService(database, gacha);
}

function duelFixture() {
  const creatorWallet = 'creator-wallet';
  const opponentWallet = 'opponent-wallet';
  const operation = (side: DuelSide, suffix: string) => ({
    generateIdempotencyKey: `generate-${suffix}`,
    openIdempotencyKey: `open-${suffix}`,
    payloadHash: suffix.repeat(64),
    provider: 'dailydraft-devnet',
    providerPackId: 'pokemon-50',
    providerReference: `provider-${suffix}`,
    recipientWallet: side === DuelSide.CREATOR ? creatorWallet : opponentWallet,
    resultHash: (suffix === 'a' ? 'b' : 'c').repeat(64),
    side,
    signature: `signature-${suffix}`,
    signatureAlgorithm: 'ed25519',
    signingKeyReference: 'fixture-key-v1',
  });
  const operations = [operation(DuelSide.CREATOR, 'a'), operation(DuelSide.OPPONENT, 'b')];
  const rgsCommitment = createDuelRgsCommitment({
    duelId: 'duel_rgs_fixture',
    operations,
    packId: 'pokemon_50',
    providerMode: 'DAILYDRAFT_DEVNET',
    rulesHash: 'e'.repeat(64),
  });
  return {
    creatorWallet,
    id: 'duel_rgs_fixture',
    packId: 'pokemon_50',
    packOutcomes: [
      { resultHash: 'b'.repeat(64), side: DuelSide.CREATOR },
      { resultHash: 'c'.repeat(64), side: DuelSide.OPPONENT },
    ],
    providerMode: 'DAILYDRAFT_DEVNET',
    providerOperations: operations,
    providerPackId: 'pokemon-50',
    resultHash: 'd'.repeat(64),
    resultReadyAt: new Date('2026-07-27T12:00:00.000Z'),
    rgsCommitmentHash: rgsCommitment.commitmentHash,
    rgsConfigHash: rgsCommitment.configHash,
    rgsRulesHash: rgsCommitment.rulesHash,
    settledAt: new Date('2026-07-27T12:01:00.000Z'),
    valuationPolicyHash: 'e'.repeat(64),
    winnerWallet: creatorWallet,
  };
}
