import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { DatabaseClient } from '@dailydraft/db';

import { FLIP_INVENTORY_SCHEMA_VERSION } from './flip-inventory-snapshot.service.js';
import {
  createFixtureFlipRuleSet,
  FLIP_PROBABILITY_SCALE_PPM,
  type FlipRuleSet,
  FlipRulesContractError,
  FlipRulesService,
  flipOutcomeBandForValue,
  hashFlipRuleSet,
  prepareFlipSessionPoolCommitment,
  validateFlipRuleSet,
} from './flip-rules.service.js';

const REVIEWED_AT = new Date('2026-08-03T12:01:00.000Z');
const COMMITTED_AT = new Date('2026-08-03T12:02:00.000Z');
const SNAPSHOT_HASH = 'a'.repeat(64);
const ORIGINAL_ENV = {
  fixture: process.env.DAILYDRAFT_FLIP_FIXTURE_MODE,
  node: process.env.NODE_ENV,
  vercel: process.env.VERCEL_ENV,
};

afterEach(() => {
  restoreEnvironment('DAILYDRAFT_FLIP_FIXTURE_MODE', ORIGINAL_ENV.fixture);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENV.node);
  restoreEnvironment('VERCEL_ENV', ORIGINAL_ENV.vercel);
});

describe('versioned Flip rules', () => {
  test('round-trips the reviewed canonical hash and freezes validated bands', () => {
    const rules = createFixtureFlipRuleSet();
    const validated = validateFlipRuleSet(rules);

    expect(validated.rulesHash).toBe(hashFlipRuleSet(stripHash(rules)));
    expect(validated.rulesHash).toBe(
      '57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c',
    );
    expect(validated.reviewedAt).toBe(REVIEWED_AT.toISOString());
    expect(validated.probabilityScalePpm).toBe(FLIP_PROBABILITY_SCALE_PPM);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.bands)).toBe(true);
    expect(validated.bands.every(Object.isFrozen)).toBe(true);
  });

  test('rejects absent, unsupported, malformed, and hash-tampered reviewed configuration', () => {
    const rules = createFixtureFlipRuleSet();
    const cases: Array<{
      candidate: unknown;
      code: FlipRulesContractError['code'];
    }> = [
      { candidate: null, code: 'UNSUPPORTED_RULES' },
      {
        candidate: { ...rules, schemaVersion: 'dailydraft.flip-rules.v2' },
        code: 'UNSUPPORTED_RULES',
      },
      {
        candidate: { ...rules, calculatorVersion: 'dailydraft.flip-outcome-bands.v2' },
        code: 'UNSUPPORTED_RULES',
      },
      { candidate: { ...rules, activation: 'production' }, code: 'UNSUPPORTED_RULES' },
      { candidate: { ...rules, currency: 'USD' }, code: 'INVALID_RULES' },
      { candidate: { ...rules, decimals: 2 }, code: 'INVALID_RULES' },
      { candidate: { ...rules, probabilityScalePpm: 100 }, code: 'INVALID_RULES' },
      { candidate: { ...rules, rulesKey: 'INVALID KEY' }, code: 'INVALID_RULES' },
      { candidate: { ...rules, poolKey: '' }, code: 'INVALID_RULES' },
      { candidate: { ...rules, inventoryPolicyVersion: 'Bad policy' }, code: 'INVALID_RULES' },
      { candidate: { ...rules, version: 0 }, code: 'INVALID_RULES' },
      { candidate: { ...rules, houseEdgePpm: -1 }, code: 'INVALID_RULES' },
      { candidate: { ...rules, stakeAmount: '0' }, code: 'INVALID_RULES' },
      { candidate: { ...rules, stakeAmount: '050000000' }, code: 'INVALID_RULES' },
      { candidate: { ...rules, feeAmount: '50000001' }, code: 'INVALID_RULES' },
      {
        candidate: { ...rules, stakeAmount: '18446744073709551616' },
        code: 'INVALID_RULES',
      },
      { candidate: { ...rules, reviewReference: ' review ' }, code: 'INVALID_RULES' },
      { candidate: { ...rules, reviewedAt: 'not-a-date' }, code: 'INVALID_RULES' },
      { candidate: { ...rules, rulesHash: 'not-a-hash' }, code: 'RULES_HASH_MISMATCH' },
      { candidate: { ...rules, bands: [] }, code: 'INVALID_RULES' },
      { candidate: { ...rules, bands: [null] }, code: 'INVALID_RULES' },
      {
        candidate: {
          ...rules,
          bands: rules.bands.map((band) =>
            band.label === 'plus' ? { ...band, label: 'base' } : band,
          ),
        },
        code: 'INVALID_RULES',
      },
      {
        candidate: {
          ...rules,
          bands: rules.bands.map((band) =>
            band.label === 'plus' ? { ...band, minimumValueAmount: '0' } : band,
          ),
        },
        code: 'INVALID_RULES',
      },
      {
        candidate: {
          ...rules,
          bands: rules.bands.map((band) =>
            band.label === 'base' ? { ...band, minimumValueAmount: '1' } : band,
          ),
        },
        code: 'INVALID_RULES',
      },
      {
        candidate: {
          ...rules,
          bands: rules.bands.map((band) =>
            band.label === 'base' ? { ...band, probabilityPpm: 699_999 } : band,
          ),
        },
        code: 'PROBABILITY_TOTAL_MISMATCH',
      },
      {
        candidate: {
          ...rules,
          bands: rules.bands.map((band) =>
            band.label === 'base' ? { ...band, minimumValueAmount: '00' } : band,
          ),
        },
        code: 'INVALID_RULES',
      },
      {
        candidate: {
          ...rules,
          feeAmount: '2000001',
        },
        code: 'RULES_HASH_MISMATCH',
      },
    ];

    for (const { candidate, code } of cases) {
      expectContractError(() => validateFlipRuleSet(candidate), code);
    }
  });

  test('classifies exact value boundaries and fails closed without bands', () => {
    const rules = createFixtureFlipRuleSet();

    expect(flipOutcomeBandForValue(rules.bands, '0').label).toBe('base');
    expect(flipOutcomeBandForValue(rules.bands, '24999999').label).toBe('base');
    expect(flipOutcomeBandForValue(rules.bands, '25000000').label).toBe('plus');
    expect(flipOutcomeBandForValue(rules.bands, '50000000').label).toBe('chase');
    expectContractError(() => flipOutcomeBandForValue([], '0'), 'INVALID_RULES');
    expectContractError(() => flipOutcomeBandForValue(rules.bands, '-1'), 'INVALID_RULES');
  });
});

describe('Flip session pool commitment', () => {
  test('commits a reproducible public outcome space without secret material', () => {
    const rules = createFixtureFlipRuleSet();
    const first = prepareFlipSessionPoolCommitment({
      committedAt: COMMITTED_AT,
      rules,
      sessionReference: 'flip_session_fixture_001',
      snapshot: snapshot(),
    });
    const replay = prepareFlipSessionPoolCommitment({
      committedAt: COMMITTED_AT,
      rules,
      sessionReference: 'flip_session_fixture_001',
      snapshot: snapshot(),
    });

    expect(first).toEqual(replay);
    expect(first.poolCommitmentHash).toBe(
      'da050f415fce611ca4658647501a5667a0816d6e7da586462bd47e42a5439c4e',
    );
    expect(first.outcomeSpace).toEqual([
      {
        bandLabel: 'base',
        listingValueAmount: '20000000',
        ordinal: 0,
        providerAssetReference: 'asset_base',
        providerListingReference: 'listing_base',
      },
      {
        bandLabel: 'plus',
        listingValueAmount: '30000000',
        ordinal: 2,
        providerAssetReference: 'asset_plus',
        providerListingReference: 'listing_plus',
      },
      {
        bandLabel: 'chase',
        listingValueAmount: '60000000',
        ordinal: 4,
        providerAssetReference: 'asset_chase',
        providerListingReference: 'listing_chase',
      },
    ]);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('seed');
    expect(serialized).not.toContain('entropy');
    expect(serialized).not.toContain('credential');
  });

  test('changes the commitment when reviewed rules or eligible outcomes change', () => {
    const rules = createFixtureFlipRuleSet();
    const baseline = prepare(rules, snapshot());
    const changedRules = createFixtureFlipRuleSet({
      bands: [
        { label: 'base', minimumValueAmount: '0', probabilityPpm: 650_000 },
        { label: 'plus', minimumValueAmount: '25000000', probabilityPpm: 300_000 },
        { label: 'chase', minimumValueAmount: '50000000', probabilityPpm: 50_000 },
      ],
      version: 2,
    });
    const changedOutcome = snapshot({
      entries: [
        entry(0, 'base', '20000000'),
        entry(2, 'plus', '31000000'),
        entry(4, 'chase', '60000000'),
      ],
    });

    expect(prepare(changedRules, snapshot()).poolCommitmentHash).not.toBe(
      baseline.poolCommitmentHash,
    );
    expect(prepare(rules, changedOutcome).poolCommitmentHash).not.toBe(baseline.poolCommitmentHash);
  });

  test('rejects absent, unsealed, malformed, stale, or incompatible pool evidence', () => {
    const rules = createFixtureFlipRuleSet();
    const cases: Array<{
      candidate: Parameters<typeof snapshot>[0] | null;
      message: string;
    }> = [
      { candidate: null, message: 'snapshot is required' },
      { candidate: { sealedAt: null }, message: 'not sealed' },
      { candidate: { schemaVersion: 'dailydraft.flip-inventory.v2' }, message: 'unsupported' },
      { candidate: { poolKey: 'another-pool' }, message: 'do not match' },
      { candidate: { policyVersion: 'another-policy' }, message: 'do not match' },
      { candidate: { stakeAmount: '51000000' }, message: 'do not match' },
      { candidate: { stakeCurrency: 'USD' }, message: 'do not match' },
      { candidate: { contentHash: 'invalid' }, message: 'content hash is invalid' },
      { candidate: { revision: 0 }, message: 'outcome count is invalid' },
      { candidate: { eligibleCount: 2 }, message: 'outcome count is invalid' },
      {
        candidate: { evaluatedAt: new Date('2026-08-03T12:03:00.000Z') },
        message: 'cannot predate',
      },
      {
        candidate: {
          entries: [
            entry(2, 'base', '20000000'),
            entry(1, 'plus', '30000000'),
            entry(4, 'chase', '60000000'),
          ],
        },
        message: 'not strictly ordered',
      },
      {
        candidate: {
          entries: [
            entry(0, 'same', '20000000'),
            entry(2, 'same', '30000000'),
            entry(4, 'chase', '60000000'),
          ],
        },
        message: 'duplicated',
      },
      {
        candidate: {
          entries: [
            entry(0, 'base', '20000000', { eligibilityListingValueCurrency: 'USD' }),
            entry(2, 'plus', '30000000'),
            entry(4, 'chase', '60000000'),
          ],
        },
        message: 'value semantics are invalid',
      },
      {
        candidate: {
          entries: [
            entry(0, 'base', '20000000'),
            entry(2, 'plus', '30000000'),
            entry(4, 'chase', 'invalid'),
          ],
        },
        message: 'canonical unsigned',
      },
      {
        candidate: {
          entries: [
            entry(0, 'base', '20000000'),
            entry(2, 'plus', '30000000'),
            entry(4, 'still-plus', '40000000'),
          ],
        },
        message: 'no eligible outcome for the chase band',
      },
    ];

    for (const { candidate, message } of cases) {
      expect(() =>
        prepareFlipSessionPoolCommitment({
          committedAt: COMMITTED_AT,
          rules,
          sessionReference: 'flip_session_fixture_001',
          snapshot: candidate === null ? (null as never) : snapshot(candidate),
        }),
      ).toThrow(message);
    }
  });
});

describe('FlipRulesService', () => {
  test('seals reviewed rules once and replays concurrent identical creation', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    const service = new FlipRulesService(database as unknown as DatabaseClient);
    const rules = createFixtureFlipRuleSet();

    const [first, replay] = await Promise.all([
      service.createFixtureRuleSet(rules),
      service.createFixtureRuleSet(rules),
    ]);

    expect(first).toMatchObject({ created: true, rulesHash: rules.rulesHash, version: 1 });
    expect(replay).toEqual({ ...first, created: false });
    expect(database.rules).toHaveLength(1);
    expect(database.rules[0]?.sealedAt).toBeInstanceOf(Date);
    expect(database.advisoryLocks).toBe(2);
  });

  test('rejects a changed or unsealed ruleset at an existing version', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    const service = new FlipRulesService(database as unknown as DatabaseClient);
    const rules = createFixtureFlipRuleSet();
    await service.createFixtureRuleSet(rules);

    const changed = createFixtureFlipRuleSet({ feeAmount: '1000000' });
    await expect(service.createFixtureRuleSet(changed)).rejects.toThrow(
      'already bound to different rules',
    );
    const storedRules = requireStoredRules(database);
    storedRules.sealedAt = null;
    await expect(service.createFixtureRuleSet(rules)).rejects.toThrow('not sealed');
  });

  test('binds one session reference idempotently and rejects rebinding', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    const service = new FlipRulesService(database as unknown as DatabaseClient);
    const rules = createFixtureFlipRuleSet();
    await service.createFixtureRuleSet(rules);
    database.snapshots.push(snapshot());

    const input = {
      committedAt: COMMITTED_AT,
      rulesKey: rules.rulesKey,
      rulesVersion: rules.version,
      sessionReference: 'flip_session_fixture_001',
      snapshotId: 'flipsnap_fixture_001',
    };
    const [first, replay] = await Promise.all([
      service.createFixtureSessionPoolCommitment(input),
      service.createFixtureSessionPoolCommitment(input),
    ]);

    expect(first).toMatchObject({
      created: true,
      eligibleOutcomeCount: 3,
      rulesHash: rules.rulesHash,
      snapshotContentHash: SNAPSHOT_HASH,
    });
    expect(replay).toEqual({ ...first, created: false });
    expect(database.commitments).toHaveLength(1);
    await expect(
      service.createFixtureSessionPoolCommitment({
        ...input,
        snapshotId: 'flipsnap_fixture_002',
      }),
    ).rejects.toThrow('already bound to a different ruleset or pool');
  });

  test('fails closed for missing reviewed rules, unsealed rules, and missing inventory', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    const service = new FlipRulesService(database as unknown as DatabaseClient);
    const input = {
      committedAt: COMMITTED_AT,
      rulesKey: 'flip-pokemon-50-fixture',
      rulesVersion: 1,
      sessionReference: 'flip_session_fixture_001',
      snapshotId: 'flipsnap_fixture_001',
    };

    await expect(service.createFixtureSessionPoolCommitment(input)).rejects.toThrow(
      'No reviewed Flip ruleset',
    );
    const rules = createFixtureFlipRuleSet();
    await service.createFixtureRuleSet(rules);
    const storedRules = requireStoredRules(database);
    storedRules.sealedAt = null;
    await expect(service.createFixtureSessionPoolCommitment(input)).rejects.toThrow(
      'ruleset is not sealed',
    );
    storedRules.sealedAt = new Date();
    await expect(service.createFixtureSessionPoolCommitment(input)).rejects.toThrow(
      'No sealed Flip inventory snapshot',
    );
  });

  test('stays disabled in production and without the explicit fixture flag', async () => {
    const database = new FixtureDatabase();
    const service = new FlipRulesService(database as unknown as DatabaseClient);
    process.env.NODE_ENV = 'test';
    delete process.env.DAILYDRAFT_FLIP_FIXTURE_MODE;

    await expect(service.createFixtureRuleSet(createFixtureFlipRuleSet())).rejects.toThrow(
      'disabled outside explicit fixture or preview mode',
    );
    process.env.DAILYDRAFT_FLIP_FIXTURE_MODE = 'true';
    process.env.VERCEL_ENV = 'production';
    await expect(service.createFixtureRuleSet(createFixtureFlipRuleSet())).rejects.toThrow(
      'disabled outside explicit fixture or preview mode',
    );
    expect(database.advisoryLocks).toBe(0);
  });
});

describe('Flip rules migration contract', () => {
  test('enforces sealing, append-only records, source compatibility, and no secret fields', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260728150000_flip_rules_session_pools/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TABLE "FlipRuleSet"');
    expect(migration).toContain('CREATE TABLE "FlipSessionPoolCommitment"');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "FlipRuleSet"');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "FlipSessionPoolCommitment"');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('Flip session pool commitment sources are invalid or unsealed');
    expect(migration).toContain('"eligibleOutcomeCount" <> stored_snapshot."eligibleCount"');
    expect(migration).not.toContain('"serverSeed"');
    expect(migration).not.toContain('"entropy"');
    expect(migration).not.toContain('"privateKey"');
  });
});

function prepare(rules: FlipRuleSet, candidate: ReturnType<typeof snapshot>) {
  return prepareFlipSessionPoolCommitment({
    committedAt: COMMITTED_AT,
    rules,
    sessionReference: 'flip_session_fixture_001',
    snapshot: candidate,
  });
}

function stripHash(rules: FlipRuleSet) {
  const { rulesHash: _rulesHash, ...unsigned } = rules;
  return unsigned;
}

function snapshot(overrides: Partial<StoredSnapshot> = {}): StoredSnapshot {
  return {
    contentHash: SNAPSHOT_HASH,
    eligibleCount: 3,
    entries: [
      entry(0, 'base', '20000000'),
      entry(2, 'plus', '30000000'),
      entry(4, 'chase', '60000000'),
    ],
    evaluatedAt: new Date('2026-08-03T12:00:00.000Z'),
    id: 'flipsnap_fixture_001',
    policyVersion: 'flip-fixture-policy-v1',
    poolKey: 'flip-pokemon-50',
    revision: 1,
    schemaVersion: FLIP_INVENTORY_SCHEMA_VERSION,
    sealedAt: new Date('2026-08-03T12:00:30.000Z'),
    stakeAmount: '50000000',
    stakeCurrency: 'USDC',
    stakeDecimals: 6,
    ...overrides,
  };
}

function entry(
  ordinal: number,
  reference: string,
  eligibilityListingValueAmount: string,
  overrides: Partial<StoredEntry> = {},
): StoredEntry {
  return {
    eligibilityListingValueAmount,
    eligibilityListingValueCurrency: 'USDC',
    eligibilityListingValueDecimals: 6,
    ordinal,
    providerAssetReference: `asset_${reference}`,
    providerListingReference: `listing_${reference}`,
    ...overrides,
  };
}

function expectContractError(operation: () => unknown, code: FlipRulesContractError['code']): void {
  try {
    operation();
    throw new Error('Expected FlipRulesContractError');
  } catch (error) {
    expect(error).toBeInstanceOf(FlipRulesContractError);
    expect((error as FlipRulesContractError).code).toBe(code);
  }
}

function enableFixtureMode(): void {
  process.env.NODE_ENV = 'test';
  process.env.DAILYDRAFT_FLIP_FIXTURE_MODE = 'true';
  delete process.env.VERCEL_ENV;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function requireStoredRules(database: FixtureDatabase): StoredRule {
  const rules = database.rules[0];
  if (!rules) throw new Error('Expected stored Flip rules');
  return rules;
}

interface StoredEntry {
  eligibilityListingValueAmount: string | null;
  eligibilityListingValueCurrency: string | null;
  eligibilityListingValueDecimals: number | null;
  ordinal: number;
  providerAssetReference: string;
  providerListingReference: string;
}

interface StoredSnapshot {
  contentHash: string;
  eligibleCount: number;
  entries: StoredEntry[];
  evaluatedAt: Date;
  id: string;
  policyVersion: string;
  poolKey: string;
  revision: number;
  schemaVersion: string;
  sealedAt: Date | null;
  stakeAmount: string;
  stakeCurrency: string;
  stakeDecimals: number;
}

interface StoredRule extends Omit<FlipRuleSet, 'bands' | 'reviewedAt'> {
  bands: unknown;
  id: string;
  reviewedAt: Date;
  sealedAt: Date | null;
}

interface StoredCommitment {
  eligibleOutcomeCount: number;
  id: string;
  poolCommitmentHash: string;
  rulesHash: string;
  rulesetId: string;
  sealedAt: Date | null;
  sessionReference: string;
  snapshotContentHash: string;
  snapshotId: string;
}

class FixtureDatabase {
  #transactionTail = Promise.resolve();
  advisoryLocks = 0;
  commitments: StoredCommitment[] = [];
  rules: StoredRule[] = [];
  snapshots: StoredSnapshot[] = [];

  readonly flipRuleSet = {
    create: async ({ data }: { data: Omit<StoredRule, 'sealedAt'> }) => {
      this.rules.push({ ...data, sealedAt: null });
      return data;
    },
    findUnique: async ({
      where,
    }: {
      where: { rulesKey_version: { rulesKey: string; version: number } };
    }) =>
      this.rules.find(
        (rule) =>
          rule.rulesKey === where.rulesKey_version.rulesKey &&
          rule.version === where.rulesKey_version.version,
      ) ?? null,
    updateMany: async ({
      data,
      where,
    }: {
      data: { sealedAt: Date };
      where: { id: string; sealedAt: null };
    }) => {
      const rules = this.rules.find((rule) => rule.id === where.id && rule.sealedAt === null);
      if (!rules) return { count: 0 };
      rules.sealedAt = data.sealedAt;
      return { count: 1 };
    },
  };

  readonly flipInventorySnapshot = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.snapshots.find((candidate) => candidate.id === where.id) ?? null,
  };

  readonly flipSessionPoolCommitment = {
    create: async ({
      data,
    }: {
      data: Omit<StoredCommitment, 'sealedAt'> & { outcomeSpace: unknown };
    }) => {
      const { outcomeSpace: _outcomeSpace, ...stored } = data;
      this.commitments.push({ ...stored, sealedAt: null });
      return data;
    },
    findUnique: async ({ where }: { where: { sessionReference: string } }) => {
      const existing = this.commitments.find(
        (candidate) => candidate.sessionReference === where.sessionReference,
      );
      if (!existing) return null;
      const ruleset = this.rules.find((rule) => rule.id === existing.rulesetId);
      return { ...existing, ruleset };
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: { sealedAt: Date };
      where: { id: string; sealedAt: null };
    }) => {
      const commitment = this.commitments.find(
        (candidate) => candidate.id === where.id && candidate.sealedAt === null,
      );
      if (!commitment) return { count: 0 };
      commitment.sealedAt = data.sealedAt;
      return { count: 1 };
    },
  };

  readonly $executeRaw = async () => {
    this.advisoryLocks += 1;
    return 1;
  };

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    const previous = this.#transactionTail;
    let release = () => {};
    this.#transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation(this);
    } finally {
      release();
    }
  }
}
