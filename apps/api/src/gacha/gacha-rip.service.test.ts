import { afterEach, describe, expect, test } from 'bun:test';
import { ServiceUnavailableException } from '@nestjs/common';
import type { DatabaseClient } from '@openpacksduel/db';
import { GachaRipStatus } from '@openpacksduel/db';
import type { GachaInventorySnapshotService } from './gacha-inventory-snapshot.service.js';
import { createFixtureGachaPullOddsRuleSet } from './gacha-pull-odds.js';
import { GachaRipService, selectGachaOutcome } from './gacha-rip.service.js';
import {
  type AcquiredGachaCard,
  type AcquireGachaCardInput,
  type SettledGachaRip,
  type SettleGachaRipInput,
  type SportsPackGachaCard,
  type SportsPackGachaMachine,
  SportsPackGachaProvider,
} from './sports-pack-gacha.provider.js';

const SNAPSHOT_HASH = 'a'.repeat(64);
const FIXED_SEED = 'fixture-seed-0000000001';
const ORIGINAL_ENV = {
  fixture: process.env.OPENPACKSDUEL_GACHA_FIXTURE_MODE,
  node: process.env.NODE_ENV,
  vercel: process.env.VERCEL_ENV,
};

afterEach(() => {
  restoreEnvironment('OPENPACKSDUEL_GACHA_FIXTURE_MODE', ORIGINAL_ENV.fixture);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENV.node);
  restoreEnvironment('VERCEL_ENV', ORIGINAL_ENV.vercel);
});

describe('GachaRipService', () => {
  test('persists reveal, acquisition, and settlement as distinct transitions', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    const service = serviceWith(database, provider);

    const result = await service.createFixtureRip({
      machineKey: 'collector-crypt-football-50000000-devnet-fixture',
      recipientWallet: 'devnet-fixture-recipient-wallet',
      seed: FIXED_SEED,
    });

    expect(database.transitions).toEqual([
      GachaRipStatus.SELECTED,
      GachaRipStatus.REVEALED,
      GachaRipStatus.ACQUIRED,
      GachaRipStatus.SETTLED,
    ]);
    expect(result.rip).toMatchObject({
      acquisitionReference: 'devnet-acquisition-reference',
      settlementReference: 'devnet-settlement-reference',
      status: GachaRipStatus.SETTLED,
    });
    expect(result.rip.revealedAt).toBeInstanceOf(Date);
    expect(result.rip.acquiredAt).toBeInstanceOf(Date);
    expect(result.rip.settledAt).toBeInstanceOf(Date);
    expect(provider.operations).toEqual(['acquire', 'settle']);
  });

  test('selects the same committed outcome for a fixed seed', () => {
    const rules = createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH);
    const first = selectGachaOutcome(snapshot().entries, rules, FIXED_SEED);
    const replay = selectGachaOutcome(snapshot().entries, rules, FIXED_SEED);

    expect(replay).toEqual(first);
    expect(first.assetReference).toMatch(/^devnet:fixture:asset:/);
  });

  test('fails closed before reading snapshots when fixture mode is disabled', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.OPENPACKSDUEL_GACHA_FIXTURE_MODE;
    const database = new RipDatabase();
    let snapshotReads = 0;
    const snapshots = {
      findLatestSealed: async () => {
        snapshotReads += 1;
        return snapshot();
      },
    } as unknown as GachaInventorySnapshotService;
    const service = new GachaRipService(
      database as unknown as DatabaseClient,
      snapshots,
      new RecordingProvider(),
    );

    await expect(
      service.createFixtureRip({
        machineKey: 'collector-crypt-football-50000000-devnet-fixture',
        recipientWallet: 'devnet-fixture-recipient-wallet',
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('disabled outside explicit fixture or preview mode');
    expect(snapshotReads).toBe(0);
    expect(database.transitions).toEqual([]);
  });

  test('reports provider capabilities and exposes only sealed committed odds', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const service = serviceWith(database, new RecordingProvider());

    expect(service.capability()).toMatchObject({
      availability: 'playable',
      gates: {
        acquisition: true,
        odds: true,
        provider: true,
        settlement: true,
      },
      providerMode: 'fixture',
    });
    await expect(
      service.findCommittedOdds('collector-crypt-football-50000000-devnet-fixture'),
    ).rejects.toThrow('No sealed Gacha odds commitment is available');

    database.oddsCommitment = {
      committedAt: new Date(),
      machineKey: 'collector-crypt-football-50000000-devnet-fixture',
      sealedAt: new Date(),
      version: 1,
    };
    await expect(
      service.findCommittedOdds('collector-crypt-football-50000000-devnet-fixture'),
    ).resolves.toMatchObject({ version: 1 });
  });

  test('records a terminal failure without inventing acquisition or settlement evidence', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    provider.failAcquisition = true;
    const service = serviceWith(database, provider);

    await expect(
      service.createFixtureRip({
        machineKey: 'collector-crypt-football-50000000-devnet-fixture',
        recipientWallet: 'devnet-fixture-recipient-wallet',
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('Fixture acquisition failed');
    expect(database.rip).toMatchObject({ status: GachaRipStatus.FAILED });
    expect(database.rip?.acquisitionReference).toBeUndefined();
    expect(database.rip?.settlementReference).toBeUndefined();
    expect(database.rip?.failedAt).toBeInstanceOf(Date);
    expect(provider.operations).toEqual(['acquire']);
  });

  test('rejects invalid seeds and snapshots without eligible cards', async () => {
    enableFixtureMode();
    const service = serviceWith(new RipDatabase(), new RecordingProvider());

    await expect(
      service.createFixtureRip({
        machineKey: 'collector-crypt-football-50000000-devnet-fixture',
        recipientWallet: 'devnet-fixture-recipient-wallet',
        seed: 'short',
      }),
    ).rejects.toThrow('seed is invalid');
    expect(() =>
      selectGachaOutcome(
        [{ assetReference: null, eligible: false, insuredValueMinor: null }],
        createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH),
        FIXED_SEED,
      ),
    ).toThrow('has no eligible cards');
  });
});

function serviceWith(database: RipDatabase, provider: RecordingProvider): GachaRipService {
  const snapshots = {
    findLatestSealed: async () => snapshot(),
  } as unknown as GachaInventorySnapshotService;
  return new GachaRipService(database as unknown as DatabaseClient, snapshots, provider);
}

function snapshot() {
  return {
    contentHash: SNAPSHOT_HASH,
    entries: [
      eligibleEntry('base', '35000000'),
      eligibleEntry('plus', '75000000'),
      eligibleEntry('premium', '150000000'),
      eligibleEntry('chase', '350000000'),
    ],
    sealedAt: new Date('2026-07-24T12:00:00.000Z'),
  };
}

function eligibleEntry(label: string, insuredValueMinor: string) {
  return {
    assetReference: `devnet:fixture:asset:${label}`,
    eligible: true,
    insuredValueMinor,
  };
}

class RecordingProvider extends SportsPackGachaProvider {
  readonly capabilities = Object.freeze({
    acquisition: true,
    odds: true,
    provider: true,
    settlement: true,
  });
  readonly mode = 'fixture' as const;
  failAcquisition = false;
  operations: string[] = [];

  async acquireCard(_input: AcquireGachaCardInput): Promise<AcquiredGachaCard> {
    this.operations.push('acquire');
    if (this.failAcquisition) {
      throw new ServiceUnavailableException('Fixture acquisition failed');
    }
    return { acquisitionReference: 'devnet-acquisition-reference', status: 'acquired' };
  }

  async getEligibleCards(_machineKey: string): Promise<readonly SportsPackGachaCard[]> {
    return [];
  }

  async listMachines(): Promise<readonly SportsPackGachaMachine[]> {
    return [];
  }

  async settleRip(_input: SettleGachaRipInput): Promise<SettledGachaRip> {
    this.operations.push('settle');
    return { settlementReference: 'devnet-settlement-reference', status: 'settled' };
  }
}

interface StoredRip {
  acquiredAt?: Date;
  acquisitionReference?: string;
  id: string;
  revealedAt?: Date;
  settledAt?: Date;
  settlementReference?: string;
  status: GachaRipStatus;
  [key: string]: unknown;
}

class RipDatabase {
  oddsCommitment: Record<string, unknown> | null = null;
  rip: StoredRip | null = null;
  transitions: GachaRipStatus[] = [];

  readonly gachaPullOddsCommitment = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.oddsCommitment = data;
      return data;
    },
    findFirst: async () => this.oddsCommitment,
    findUnique: async () => this.oddsCommitment,
  };

  readonly gachaRip = {
    create: async ({ data }: { data: StoredRip }) => {
      this.rip = { ...data };
      this.transitions.push(data.status);
      return this.rip;
    },
    findUnique: async () => this.rip,
    update: async ({ data }: { data: Partial<StoredRip> }) => {
      if (!this.rip) throw new Error('rip missing');
      Object.assign(this.rip, data);
      this.transitions.push(data.status as GachaRipStatus);
      return this.rip;
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: Partial<StoredRip>;
      where: { id: string; status: GachaRipStatus };
    }) => {
      if (!this.rip || this.rip.id !== where.id || this.rip.status !== where.status) {
        return { count: 0 };
      }
      Object.assign(this.rip, data);
      this.transitions.push(data.status as GachaRipStatus);
      return { count: 1 };
    },
  };

  readonly $queryRaw = async () => [{ pg_advisory_xact_lock: '' }];

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

function enableFixtureMode(): void {
  process.env.NODE_ENV = 'test';
  process.env.OPENPACKSDUEL_GACHA_FIXTURE_MODE = 'true';
  delete process.env.VERCEL_ENV;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
