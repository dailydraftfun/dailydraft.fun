import { describe, expect, test } from 'bun:test';

import {
  assertRgsTransition,
  canonicalRgsJson,
  createRgsExternalProof,
  createRgsSeedCommitment,
  createRgsSeededProof,
  deriveRgsSeededEntropy,
  hashRgsText,
  isRgsTransitionAllowed,
  RGS_CONTRACT_SCHEMA_VERSION,
  RGS_MODE_CONFIG_SCHEMA_VERSION,
  RGS_PROOF_SCHEMA_VERSION,
  rgsCompatibilityFixtures,
  verifyRgsProof,
} from './rgs.js';

const CONFIG_HASH = 'a'.repeat(64);
const RULES_HASH = 'b'.repeat(64);

describe('versioned RGS contract', () => {
  test('publishes stable compatibility fixtures for every declared mode', () => {
    expect(rgsCompatibilityFixtures.schemaVersion).toBe(RGS_CONTRACT_SCHEMA_VERSION);
    expect(Object.keys(rgsCompatibilityFixtures.modes).sort()).toEqual([
      'crash',
      'duel',
      'flip',
      'gacha',
    ]);

    for (const [mode, config] of Object.entries(rgsCompatibilityFixtures.modes)) {
      expect(String(config.mode)).toBe(mode);
      expect(config.schemaVersion).toBe(RGS_MODE_CONFIG_SCHEMA_VERSION);
      expect(config.contractVersion).toBe(RGS_CONTRACT_SCHEMA_VERSION);
      expect(config.realValueGate).toBe('hitl-required');
      expect(config.configHash).toMatch(/^[a-f0-9]{64}$/);
      expect(config.rulesHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test('allows only the commit-play-reveal-settle lifecycle and terminal failure', () => {
    expect(isRgsTransitionAllowed('session', 'committed')).toBe(true);
    expect(isRgsTransitionAllowed('committed', 'played')).toBe(true);
    expect(isRgsTransitionAllowed('played', 'revealed')).toBe(true);
    expect(isRgsTransitionAllowed('revealed', 'settled')).toBe(true);
    expect(isRgsTransitionAllowed('played', 'failed')).toBe(true);
    expect(isRgsTransitionAllowed('settled', 'settled')).toBe(true);

    expect(isRgsTransitionAllowed('session', 'settled')).toBe(false);
    expect(isRgsTransitionAllowed('settled', 'played')).toBe(false);
    expect(() => assertRgsTransition('committed', 'settled')).toThrow(
      'RGS transition committed -> settled is not allowed',
    );
  });

  test('canonicalizes nested objects before hashing', () => {
    expect(canonicalRgsJson({ b: 2, a: { d: true, c: ['x'] } })).toBe(
      '{"a":{"c":["x"],"d":true},"b":2}',
    );
    expect(() => canonicalRgsJson({ invalid: Number.NaN })).toThrow(
      'RGS canonical JSON does not allow non-finite numbers',
    );
  });

  test('preserves the existing Gacha entropy derivation byte-for-byte', () => {
    const input = {
      clientSeed: 'client-seed',
      configHash: CONFIG_HASH,
      rulesHash: RULES_HASH,
      serverSeed: 'server-seed',
    };
    expect(deriveRgsSeededEntropy(input)).toBe(
      hashRgsText(`${CONFIG_HASH}:${RULES_HASH}:server-seed:client-seed`),
    );
  });

  test('creates a context-bound seed commitment and independently verifiable reveal', () => {
    const proof = createRgsSeededProof({
      clientSeed: 'client-seed',
      commitmentId: 'gachaseed_fixture_001',
      configHash: CONFIG_HASH,
      mode: 'gacha',
      phase: 'settled',
      result: { collectibleRef: 'fixture:card:001', selectedIndex: 0 },
      roundId: 'rip_fixture_001',
      rulesHash: RULES_HASH,
      serverSeed: 'server-seed',
    });

    expect(proof.schemaVersion).toBe(RGS_PROOF_SCHEMA_VERSION);
    expect(proof.serverSeedHash).toBe(hashRgsText('server-seed'));
    expect(verifyRgsProof(proof)).toEqual({ errors: [], valid: true });
    expect(
      createRgsSeedCommitment({
        commitmentId: 'gachaseed_fixture_001',
        configHash: CONFIG_HASH,
        mode: 'gacha',
        rulesHash: RULES_HASH,
        serverSeed: 'server-seed',
      }).commitmentHash,
    ).toBe(proof.commitmentHash);

    expect(
      verifyRgsProof({
        ...proof,
        result: { collectibleRef: 'fixture:card:tampered', selectedIndex: 0 },
      }),
    ).toEqual({ errors: ['resultHash mismatch'], valid: false });
  });

  test('verifies external-provider request commitment, evidence, and result independently', () => {
    const proof = createRgsExternalProof({
      configHash: CONFIG_HASH,
      evidence: {
        creatorResultHash: 'c'.repeat(64),
        opponentResultHash: 'd'.repeat(64),
        provider: 'dailydraft-devnet',
      },
      mode: 'duel',
      phase: 'settled',
      request: {
        creator: { idempotencyKey: 'duel:creator', packId: 'pokemon-50' },
        opponent: { idempotencyKey: 'duel:opponent', packId: 'pokemon-50' },
      },
      result: { winnerSide: 'creator' },
      roundId: 'duel_fixture_001',
      rulesHash: RULES_HASH,
    });

    expect(verifyRgsProof(proof)).toEqual({ errors: [], valid: true });
    expect(
      verifyRgsProof({
        ...proof,
        evidence: {
          creatorResultHash: 'c'.repeat(64),
          opponentResultHash: 'd'.repeat(64),
          provider: 'tampered-provider',
        },
      }),
    ).toEqual({ errors: ['evidenceHash mismatch'], valid: false });
  });

  test('fails closed on malformed hashes and unsupported proof versions', () => {
    expect(() =>
      createRgsSeedCommitment({
        commitmentId: 'gachaseed_fixture_001',
        configHash: 'not-a-hash',
        mode: 'gacha',
        rulesHash: RULES_HASH,
        serverSeed: 'server-seed',
      }),
    ).toThrow('configHash must be a lowercase SHA-256 hash');

    const proof = rgsCompatibilityFixtures.seededProof;
    expect(
      verifyRgsProof({
        ...proof,
        schemaVersion: 'dailydraft.rgs-proof.v2' as typeof RGS_PROOF_SCHEMA_VERSION,
      }),
    ).toEqual({ errors: ['unsupported schemaVersion'], valid: false });
  });
});
