import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseClient } from '@dailydraft/db';
import { GachaRipStatus } from '@dailydraft/db';
import { ServiceUnavailableException } from '@nestjs/common';
import { rarityForSerializedValue } from '../common/pull-rarity.js';
import type { GachaInventorySnapshotService } from './gacha-inventory-snapshot.service.js';
import type {
  ConsumeGachaPaymentInput,
  FindConsumedGachaPaymentInput,
  GachaPaymentService,
} from './gacha-payment.service.js';
import {
  createFixtureGachaPullOddsRuleSet,
  type GachaPullOddsRuleSet,
  validateGachaPullOddsRuleSet,
} from './gacha-pull-odds.js';
import { GachaRipService, selectGachaOutcome } from './gacha-rip.service.js';
import {
  type AcquiredGachaCard,
  type AcquireGachaCardInput,
  GachaCardDefinitelyNotAcquiredError,
  type SettledGachaRip,
  type SettleGachaRipInput,
  type SportsPackGachaCard,
  type SportsPackGachaMachine,
  SportsPackGachaProvider,
} from './sports-pack-gacha.provider.js';

const SNAPSHOT_HASH = 'a'.repeat(64);
const FIXED_SEED = 'fixture-seed-0000000001';
const FIXED_SERVER_SEED = 'b'.repeat(64);
const MACHINE_KEY = 'collector-crypt-football-50000000-devnet-fixture';
const WALLET = 'devnet-fixture-recipient-wallet';
const SOLANA_WALLET = 'BkS1e5Kx8dCVAV4vXHzr4y6bTs2hUcHYD9Y4tzk6Bdub';
const ORIGINAL_ENV = {
  fixture: process.env.DAILYDRAFT_GACHA_FIXTURE_MODE,
  node: process.env.NODE_ENV,
  providerMode: process.env.DAILYDRAFT_PROVIDER_MODE,
  vercel: process.env.VERCEL_ENV,
};

afterEach(() => {
  restoreEnvironment('DAILYDRAFT_GACHA_FIXTURE_MODE', ORIGINAL_ENV.fixture);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENV.node);
  restoreEnvironment('DAILYDRAFT_PROVIDER_MODE', ORIGINAL_ENV.providerMode);
  restoreEnvironment('VERCEL_ENV', ORIGINAL_ENV.vercel);
});

describe('GachaRipService', () => {
  test('persists reveal, acquisition, and settlement as distinct transitions and reveals a verifiable server seed', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    const service = serviceWith(database, provider);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    const result = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
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
    expect(result.rip.rarity).toBe(
      rarityForSerializedValue(result.rip.insuredValueMinor, result.rip.insuredValueDecimals),
    );
    expect(result.rip.revealedAt).toBeInstanceOf(Date);
    expect(result.rip.acquiredAt).toBeInstanceOf(Date);
    expect(result.rip.settledAt).toBeInstanceOf(Date);
    expect(provider.operations).toEqual(['acquire', 'settle']);

    // Defect 1: the revealed serverSeed must hash back to the serverSeedHash that was
    // published (before the rip) by createSeedCommitment, so a player can independently
    // verify the roll.
    expect(result.serverSeed).toMatch(/^[a-f0-9]{64}$/);
    expect(result.serverSeedHash).toBe(commitment.serverSeedHash);
    expect(sha256(result.serverSeed ?? '')).toBe(commitment.serverSeedHash);
  });

  test('selects the same committed outcome for a fixed (serverSeed, clientSeed) pair', () => {
    const rules = createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH);
    const seeds = { clientSeed: FIXED_SEED, serverSeed: FIXED_SERVER_SEED };
    const first = selectGachaOutcome(snapshot().entries, rules, seeds);
    const replay = selectGachaOutcome(snapshot().entries, rules, seeds);

    expect(replay).toEqual(first);
    expect(first.assetReference).toMatch(/^devnet:fixture:asset:/);
  });

  test('grinding the client seed alone cannot control the outcome without the secret server seed', () => {
    const rules = createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH);
    // The client only ever controls clientSeed. Both hashes in the digest formula
    // (snapshotContentHash, rulesHash) are publicly readable before the rip, so if the
    // outcome depended on clientSeed alone an attacker could grind offline for a favorable
    // value. Holding clientSeed fixed and varying only the server-committed seed proves
    // the outcome cannot be predicted or forced without the secret serverSeed.
    const serverSeeds = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)];
    const outcomes = new Set(
      serverSeeds.map(
        (serverSeed) =>
          selectGachaOutcome(snapshot().entries, rules, { clientSeed: FIXED_SEED, serverSeed })
            .assetReference,
      ),
    );

    expect(outcomes.size).toBeGreaterThan(1);
  });

  test('rejects a malformed server seed defensively', () => {
    const rules = createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH);

    expect(() =>
      selectGachaOutcome(snapshot().entries, rules, {
        clientSeed: FIXED_SEED,
        serverSeed: 'not-a-valid-hex-server-seed',
      }),
    ).toThrow('serverSeed is invalid');
  });

  test('issues a seed commitment without ever exposing the raw serverSeed', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const service = serviceWith(database, new RecordingProvider());

    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    expect(Object.keys(commitment).sort()).toEqual(['commitmentId', 'expiresAt', 'serverSeedHash']);
    expect(commitment.serverSeedHash).toMatch(/^[a-f0-9]{64}$/);
    const stored = database.seedCommitments.find(
      (candidate) => candidate.id === commitment.commitmentId,
    );
    expect(stored).toBeDefined();
    expect(stored?.serverSeedHash).toBe(commitment.serverSeedHash);
    expect(sha256(stored?.serverSeed ?? '')).toBe(commitment.serverSeedHash);
  });

  test('rejects reusing a seed commitment for a second rip', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const service = serviceWith(database, new RecordingProvider());
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: FIXED_SEED,
    });

    await expect(
      service.createFixtureRip({
        commitmentId: commitment.commitmentId,
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: 'a-second-distinct-client-seed-value',
      }),
    ).rejects.toThrow('already been consumed');
    expect(database.rips).toHaveLength(1);
  });

  test('rejects an expired seed commitment', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const service = serviceWith(database, new RecordingProvider());
    const serverSeed = 'e'.repeat(64);
    database.seedCommitments.push({
      committedAt: new Date('2020-01-01T00:00:00.000Z'),
      consumedByRipId: null,
      expiresAt: new Date('2020-01-01T00:15:00.000Z'),
      id: 'gachaseed_expired0000000000000000',
      machineKey: MACHINE_KEY,
      serverSeed,
      serverSeedHash: sha256(serverSeed),
    });

    await expect(
      service.createFixtureRip({
        commitmentId: 'gachaseed_expired0000000000000000',
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('has expired');
    expect(database.rips).toHaveLength(0);
  });

  test('rejects a commitmentId that does not exist', async () => {
    enableFixtureMode();
    const service = serviceWith(new RipDatabase(), new RecordingProvider());

    await expect(
      service.createFixtureRip({
        commitmentId: 'gachaseed_does_not_exist00000000000',
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('was not found');
  });

  test('rejects a seed commitment issued for a different machine', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const service = serviceWith(database, new RecordingProvider());
    const commitment = await service.createSeedCommitment(
      'collector-crypt-baseball-50000000-devnet-fixture',
    );

    await expect(
      service.createFixtureRip({
        commitmentId: commitment.commitmentId,
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('was not found');
  });

  test('rejects a second rip once the only card in a band has been depleted', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const service = serviceWith(database, new RecordingProvider());
    const rules = validateGachaPullOddsRuleSet(createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH));

    const first = await service.createSeedCommitment(MACHINE_KEY);
    const firstServerSeed = requireStoredServerSeed(database, first.commitmentId);
    const firstClientSeed = findSeedLandingInBand(rules, firstServerSeed, 'base');
    const firstRip = await service.createFixtureRip({
      commitmentId: first.commitmentId,
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: firstClientSeed,
    });
    expect(firstRip.rip.selectedAssetReference).toBe('devnet:fixture:asset:base');

    const second = await service.createSeedCommitment(MACHINE_KEY);
    const secondServerSeed = requireStoredServerSeed(database, second.commitmentId);
    const secondClientSeed = findSeedLandingInBand(rules, secondServerSeed, 'base');

    await expect(
      service.createFixtureRip({
        commitmentId: second.commitmentId,
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: secondClientSeed,
      }),
    ).rejects.toThrow('Gacha inventory has no eligible base cards');
  });

  test('yields two distinct assets when a band holds two eligible cards across two rips', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const service = serviceWith(database, new RecordingProvider(), twoCardBaseSnapshot());
    const rules = validateGachaPullOddsRuleSet(createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH));

    const first = await service.createSeedCommitment(MACHINE_KEY);
    const firstServerSeed = requireStoredServerSeed(database, first.commitmentId);
    const firstClientSeed = findSeedLandingInBand(rules, firstServerSeed, 'base');
    const firstRip = await service.createFixtureRip({
      commitmentId: first.commitmentId,
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: firstClientSeed,
    });

    const second = await service.createSeedCommitment(MACHINE_KEY);
    const secondServerSeed = requireStoredServerSeed(database, second.commitmentId);
    const secondClientSeed = findSeedLandingInBand(rules, secondServerSeed, 'base');
    const secondRip = await service.createFixtureRip({
      commitmentId: second.commitmentId,
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: secondClientSeed,
    });

    expect(secondRip.rip.selectedAssetReference).not.toBe(firstRip.rip.selectedAssetReference);
    expect(
      new Set([firstRip.rip.selectedAssetReference, secondRip.rip.selectedAssetReference]).size,
    ).toBe(2);
  });

  test('the snapshotContentHash + selectedAssetReference unique index rejects a duplicate insert', async () => {
    const database = new RipDatabase();
    await database.gachaRip.create({
      data: baseRipRow({
        id: 'gacharip_duplicate_probe_one',
        selectedAssetReference: 'devnet:fixture:asset:base',
        snapshotContentHash: SNAPSHOT_HASH,
      }),
    });

    await expect(
      database.gachaRip.create({
        data: baseRipRow({
          id: 'gacharip_duplicate_probe_two',
          selectedAssetReference: 'devnet:fixture:asset:base',
          snapshotContentHash: SNAPSHOT_HASH,
        }),
      }),
    ).rejects.toThrow('GachaRip_snapshotContentHash_selectedAssetReference_key');
  });

  test('the provable-fairness migration declares the depletion and idempotency unique indexes', () => {
    const migrationPath = fileURLToPath(
      new URL(
        '../../../../packages/db/prisma/migrations/20260724140000_gacha_provable_fairness/migration.sql',
        import.meta.url,
      ),
    );
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "GachaRip_snapshotContentHash_selectedAssetReference_key"',
    );
    expect(migration).toContain('CREATE UNIQUE INDEX "GachaRip_machineKey_idempotencyKey_key"');
  });

  test('the payment migration persists and constrains lifecycle recovery leases', () => {
    const migrationPath = fileURLToPath(
      new URL(
        '../../../../packages/db/prisma/migrations/20260726120000_gacha_rip_payments/migration.sql',
        import.meta.url,
      ),
    );
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('ADD COLUMN "recipientWallet" TEXT');
    expect(migration).toContain('ADD COLUMN "lifecycleLeaseOwner" TEXT');
    expect(migration).toContain('"GachaRip_status_lifecycleLeaseExpiresAt_idx"');
    expect(migration).toContain('"GachaRip_lifecycle_recovery_check"');
  });

  test('returns the existing rip when the same idempotency key is replayed', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    const service = serviceWith(database, provider);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    const first = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      idempotencyKey: 'idem-key-replay',
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: FIXED_SEED,
    });

    const replay = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      idempotencyKey: 'idem-key-replay',
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: 'a-completely-different-seed-value',
    });

    expect(replay.rip.id).toBe(first.rip.id);
    expect(replay.rip.selectedAssetReference).toBe(first.rip.selectedAssetReference);
    expect(database.rips).toHaveLength(1);
    expect(provider.operations).toEqual(['acquire', 'settle']);
  });

  test('fails closed when a legacy idempotency replay has no recipient wallet', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    const service = serviceWith(database, provider);
    await database.gachaRip.create({
      data: baseRipRow({
        id: 'gacharip_legacy_null_recipient',
        idempotencyKey: 'idem-key-legacy-null-recipient',
        recipientWallet: null,
      }),
    });

    await expect(
      service.createFixtureRip({
        commitmentId: `gachaseed_${'a'.repeat(32)}`,
        idempotencyKey: 'idem-key-legacy-null-recipient',
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('Gacha rip replay changed its recipient wallet');
    expect(provider.operations).toEqual([]);
  });

  test('creates distinct rips for distinct idempotency keys', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const service = serviceWith(database, new RecordingProvider());
    const rules = validateGachaPullOddsRuleSet(createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH));

    const commitmentOne = await service.createSeedCommitment(MACHINE_KEY);
    const serverSeedOne = requireStoredServerSeed(database, commitmentOne.commitmentId);
    const first = await service.createFixtureRip({
      commitmentId: commitmentOne.commitmentId,
      idempotencyKey: 'idem-key-a',
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: findSeedLandingInBand(rules, serverSeedOne, 'base'),
    });

    const commitmentTwo = await service.createSeedCommitment(MACHINE_KEY);
    const serverSeedTwo = requireStoredServerSeed(database, commitmentTwo.commitmentId);
    const second = await service.createFixtureRip({
      commitmentId: commitmentTwo.commitmentId,
      idempotencyKey: 'idem-key-b',
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: findSeedLandingInBand(rules, serverSeedTwo, 'plus'),
    });

    expect(second.rip.id).not.toBe(first.rip.id);
    expect(database.rips).toHaveLength(2);
  });

  test('reveals the server seed on an idempotent replay of a rip that previously failed', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    provider.failAcquisition = true;
    const service = serviceWith(database, provider);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    await expect(
      service.createFixtureRip({
        commitmentId: commitment.commitmentId,
        idempotencyKey: 'idem-key-failed',
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('Fixture acquisition failed');

    const replay = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      idempotencyKey: 'idem-key-failed',
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: 'irrelevant-because-replay-short-circuits',
    });

    expect(replay.rip.status).toBe(GachaRipStatus.FAILED);
    const { serverSeed, serverSeedHash } = replay;
    if (serverSeed === null || serverSeedHash === null) {
      throw new Error('expected a failed rip replay to reveal the server seed');
    }
    expect(sha256(serverSeed)).toBe(serverSeedHash);
    expect(database.rips).toHaveLength(1);
  });

  test('resumes a post-commit rip whose prior lifecycle owner disappeared', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    const service = serviceWith(database, provider);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);
    await database.gachaPullOddsCommitment.create({
      data: { id: 'gachaodds_manual', version: 1 },
    });
    const inFlightRip = await database.gachaRip.create({
      data: baseRipRow({
        id: 'gacharip_in_flight',
        idempotencyKey: 'idem-in-flight',
        oddsCommitmentId: 'gachaodds_manual',
        selectedAssetReference: 'devnet:fixture:asset:in-flight',
        lifecycleLeaseExpiresAt: new Date(Date.now() - 1_000),
        lifecycleLeaseOwner: 'crashed-process',
        status: GachaRipStatus.SELECTED,
      }),
    });
    await database.gachaRipSeedCommitment.updateMany({
      data: { consumedByRipId: inFlightRip.id },
      where: { consumedByRipId: null, expiresAt: { gt: new Date(0) }, id: commitment.commitmentId },
    });

    const replay = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      idempotencyKey: 'idem-in-flight',
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: FIXED_SEED,
    });

    expect(replay.rip.status).toBe(GachaRipStatus.SETTLED);
    expect(replay.serverSeed).toBeTruthy();
    expect(replay.serverSeedHash).toBe(commitment.serverSeedHash);
    expect(provider.operations).toEqual(['acquire', 'settle']);
  });

  test('does not duplicate provider work while another lifecycle lease is active', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    const service = serviceWith(database, provider);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);
    await database.gachaPullOddsCommitment.create({
      data: { id: 'gachaodds_active_lease', version: 1 },
    });
    const inFlightRip = await database.gachaRip.create({
      data: baseRipRow({
        id: 'gacharip_active_lease',
        idempotencyKey: 'idem-active-lease',
        lifecycleLeaseExpiresAt: new Date(Date.now() + 60_000),
        lifecycleLeaseOwner: 'active-process',
        oddsCommitmentId: 'gachaodds_active_lease',
        status: GachaRipStatus.REVEALED,
      }),
    });
    await database.gachaRipSeedCommitment.updateMany({
      data: { consumedByRipId: inFlightRip.id },
      where: { consumedByRipId: null, expiresAt: { gt: new Date(0) }, id: commitment.commitmentId },
    });

    await expect(
      service.createFixtureRip({
        commitmentId: commitment.commitmentId,
        idempotencyKey: 'idem-active-lease',
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('already in progress');
    expect(provider.operations).toEqual([]);
  });

  test('uses a consumed payment as the replay anchor when no idempotency key was sent', async () => {
    enableDevnetMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    const payments = new RecordingPayments();
    const service = serviceWith(database, provider, snapshot(), payments);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);
    await database.gachaPullOddsCommitment.create({
      data: { id: 'gachaodds_paid_recovery', version: 1 },
    });
    const inFlightRip = await database.gachaRip.create({
      data: baseRipRow({
        id: 'gacharip_paid_recovery',
        oddsCommitmentId: 'gachaodds_paid_recovery',
        recipientWallet: SOLANA_WALLET,
        selectedAssetReference: 'devnet:fixture:asset:paid-recovery',
        status: GachaRipStatus.SELECTED,
      }),
    });
    await database.gachaRipSeedCommitment.updateMany({
      data: { consumedByRipId: inFlightRip.id },
      where: { consumedByRipId: null, expiresAt: { gt: new Date(0) }, id: commitment.commitmentId },
    });
    const paymentIntentId = `gachapay_${'e'.repeat(32)}`;
    payments.recordConsumed({
      intentId: paymentIntentId,
      machineKey: MACHINE_KEY,
      now: new Date(),
      payerWallet: SOLANA_WALLET,
      ripId: inFlightRip.id,
    });

    const recovered = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      machineKey: MACHINE_KEY,
      paymentIntentId,
      recipientWallet: SOLANA_WALLET,
      seed: FIXED_SEED,
    });

    expect(recovered.rip.status).toBe(GachaRipStatus.SETTLED);
    expect(database.rips).toHaveLength(1);
    expect(payments.consumed).toHaveLength(1);
    expect(provider.operations).toEqual(['acquire', 'settle']);
  });

  test('fails closed before reading snapshots when fixture and devnet modes are disabled', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DAILYDRAFT_GACHA_FIXTURE_MODE;
    delete process.env.DAILYDRAFT_PROVIDER_MODE;
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
      new RecordingPayments() as unknown as GachaPaymentService,
    );

    await expect(
      service.createFixtureRip({
        commitmentId: 'gachaseed_unused',
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('disabled outside explicit fixture, preview, or devnet mode');
    expect(snapshotReads).toBe(0);
    expect(database.transitions).toEqual([]);
  });

  test('spends the verified payment intent on the rip when devnet mode requires funding', async () => {
    enableDevnetMode();
    const database = new RipDatabase();
    const payments = new RecordingPayments();
    const service = serviceWith(database, new RecordingProvider(), snapshot(), payments);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    const result = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      machineKey: MACHINE_KEY,
      paymentIntentId: `gachapay_${'c'.repeat(32)}`,
      recipientWallet: WALLET,
      seed: FIXED_SEED,
    });

    expect(result.rip.status).toBe(GachaRipStatus.SETTLED);
    expect(payments.consumed).toHaveLength(1);
    expect(payments.consumed[0]).toMatchObject({
      intentId: `gachapay_${'c'.repeat(32)}`,
      machineKey: MACHINE_KEY,
      // Single-player: the payer and the recipient are the same wallet.
      payerWallet: WALLET,
      ripId: result.rip.id,
    });
  });

  test('refuses a funded rip that names no payment intent', async () => {
    enableDevnetMode();
    const database = new RipDatabase();
    const payments = new RecordingPayments();
    const service = serviceWith(database, new RecordingProvider(), snapshot(), payments);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    await expect(
      service.createFixtureRip({
        commitmentId: commitment.commitmentId,
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('requires a verified payment intent');
    expect(payments.consumed).toEqual([]);
    expect(database.transitions).toEqual([]);
  });

  test('keeps the rip and the payment consistent when the intent cannot be spent', async () => {
    enableDevnetMode();
    const database = new RipDatabase();
    const payments = new RecordingPayments();
    payments.failure = new Error('Gacha rip payment is not verified or was already consumed');
    const service = serviceWith(database, new RecordingProvider(), snapshot(), payments);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    await expect(
      service.createFixtureRip({
        commitmentId: commitment.commitmentId,
        machineKey: MACHINE_KEY,
        paymentIntentId: `gachapay_${'d'.repeat(32)}`,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('is not verified or was already consumed');
    // The throw happens inside the rip transaction, before the reveal, so the rip
    // never advances past SELECTED. Postgres rolls the row back too; this in-memory
    // fake has no rollback, which is why the insert is still visible here.
    expect(database.transitions).toEqual([GachaRipStatus.SELECTED]);
    // The load-bearing assertion: an unspendable payment must not burn the seed.
    const stored = await database.gachaRipSeedCommitment.findUnique({
      where: { id: commitment.commitmentId },
    });
    expect(stored?.consumedByRipId).toBeNull();
  });

  test('leaves fixture rips unfunded even when devnet credentials are present', async () => {
    enableFixtureMode();
    process.env.DAILYDRAFT_PROVIDER_MODE = 'dailydraft-devnet';
    const database = new RipDatabase();
    const payments = new RecordingPayments();
    const service = serviceWith(database, new RecordingProvider(), snapshot(), payments);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    const result = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      machineKey: MACHINE_KEY,
      paymentIntentId: `gachapay_${'f'.repeat(32)}`,
      recipientWallet: WALLET,
      seed: FIXED_SEED,
    });

    expect(result.rip.status).toBe(GachaRipStatus.SETTLED);
    expect(payments.consumed).toEqual([]);
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
    await expect(service.findCommittedOdds(MACHINE_KEY)).rejects.toThrow(
      'No sealed Gacha odds commitment is available',
    );

    database.oddsCommitment = {
      committedAt: new Date(),
      machineKey: MACHINE_KEY,
      sealedAt: new Date(),
      version: 1,
    };
    await expect(service.findCommittedOdds(MACHINE_KEY)).resolves.toMatchObject({ version: 1 });
  });

  test('records a terminal failure without inventing acquisition or settlement evidence', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    provider.failAcquisition = true;
    const service = serviceWith(database, provider);
    const rules = validateGachaPullOddsRuleSet(createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH));
    const commitment = await service.createSeedCommitment(MACHINE_KEY);
    // createSeedCommitment mints a fresh random serverSeed, so the landing band is only
    // deterministic once the client seed is chosen against that specific server seed.
    const serverSeed = requireStoredServerSeed(database, commitment.commitmentId);
    const clientSeed = findSeedLandingInBand(rules, serverSeed, 'base');

    await expect(
      service.createFixtureRip({
        commitmentId: commitment.commitmentId,
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: clientSeed,
      }),
    ).rejects.toThrow('Fixture acquisition failed');
    expect(database.rip).toMatchObject({ status: GachaRipStatus.FAILED });
    expect(database.rip?.acquisitionReference).toBeUndefined();
    expect(database.rip?.settlementReference).toBeUndefined();
    expect(database.rip?.failedAt).toBeInstanceOf(Date);
    expect(provider.operations).toEqual(['acquire']);
    // The asset was never delivered, so it must be released back to the eligible pool
    // rather than permanently burned: selectedAssetReference clears to null and the
    // audit trail moves to failedAssetReference.
    expect(database.rip?.selectedAssetReference).toBeNull();
    expect(database.rip?.failedAssetReference).toBe('devnet:fixture:asset:base');
  });

  test('keeps a transient acquisition failure REVEALED and resumes it idempotently', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    provider.transientAcquisitionFailures = 1;
    const service = serviceWith(database, provider);
    const commitment = await service.createSeedCommitment(MACHINE_KEY);

    await expect(
      service.createFixtureRip({
        commitmentId: commitment.commitmentId,
        idempotencyKey: 'idem-transient-acquisition',
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: FIXED_SEED,
      }),
    ).rejects.toThrow('Fixture acquisition outcome is unknown');
    expect(database.rip).toMatchObject({
      lifecycleLeaseExpiresAt: null,
      lifecycleLeaseOwner: null,
      status: GachaRipStatus.REVEALED,
    });
    const retainedAssetReference = database.rip?.selectedAssetReference;
    if (!retainedAssetReference) {
      throw new Error('expected the transient rip to retain its selected asset');
    }
    expect(retainedAssetReference).toMatch(/^devnet:fixture:asset:/);
    expect(database.rip?.failedAssetReference).toBeUndefined();

    const resumed = await service.createFixtureRip({
      commitmentId: commitment.commitmentId,
      idempotencyKey: 'idem-transient-acquisition',
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: 'ignored-on-idempotent-replay',
    });

    expect(resumed.rip.status).toBe(GachaRipStatus.SETTLED);
    expect(resumed.rip.selectedAssetReference).toBe(retainedAssetReference);
    expect(provider.operations).toEqual(['acquire', 'acquire', 'settle']);
  });

  test('does not reallocate an asset after an ambiguous acquisition outcome', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    provider.transientAcquisitionFailures = 1;
    provider.deliverBeforeTransientFailure = true;
    const service = serviceWith(database, provider, twoCardBaseSnapshot());
    const rules = validateGachaPullOddsRuleSet(createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH));

    const first = await service.createSeedCommitment(MACHINE_KEY);
    const firstServerSeed = requireStoredServerSeed(database, first.commitmentId);
    const firstClientSeed = findSeedLandingInBand(rules, firstServerSeed, 'base');
    await expect(
      service.createFixtureRip({
        commitmentId: first.commitmentId,
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: firstClientSeed,
      }),
    ).rejects.toThrow('Fixture acquisition outcome is unknown');

    const ambiguousRip = database.rip;
    if (!ambiguousRip?.selectedAssetReference) {
      throw new Error('expected the ambiguous rip to retain its selected asset');
    }
    expect(ambiguousRip.status).toBe(GachaRipStatus.REVEALED);
    expect(provider.deliveredAssetReferences).toContain(ambiguousRip.selectedAssetReference);

    const second = await service.createSeedCommitment(MACHINE_KEY);
    const secondServerSeed = requireStoredServerSeed(database, second.commitmentId);
    const secondClientSeed = findSeedLandingInBand(rules, secondServerSeed, 'base');
    const settled = await service.createFixtureRip({
      commitmentId: second.commitmentId,
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: secondClientSeed,
    });

    expect(settled.rip.status).toBe(GachaRipStatus.SETTLED);
    expect(settled.rip.selectedAssetReference).not.toBe(ambiguousRip.selectedAssetReference);
    expect(ambiguousRip.selectedAssetReference).not.toBeNull();
    expect(ambiguousRip.status).toBe(GachaRipStatus.REVEALED);
  });

  test('a rip that fails acquisition releases its asset for a later rip to claim', async () => {
    enableFixtureMode();
    const database = new RipDatabase();
    const provider = new RecordingProvider();
    provider.failAcquisition = true;
    const service = serviceWith(database, provider);
    const rules = validateGachaPullOddsRuleSet(createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH));

    const first = await service.createSeedCommitment(MACHINE_KEY);
    const firstServerSeed = requireStoredServerSeed(database, first.commitmentId);
    const firstClientSeed = findSeedLandingInBand(rules, firstServerSeed, 'base');

    await expect(
      service.createFixtureRip({
        commitmentId: first.commitmentId,
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: firstClientSeed,
      }),
    ).rejects.toThrow('Fixture acquisition failed');

    const failedRip = database.rip;
    if (failedRip === null) throw new Error('expected the failed rip to be persisted');
    expect(failedRip.status).toBe(GachaRipStatus.FAILED);
    expect(failedRip.selectedAssetReference).toBeNull();
    expect(failedRip.failedAssetReference).toBe('devnet:fixture:asset:base');

    // Without the fix, this second rip would land on the same asset the failed rip
    // still held and crash with a P2002 on the depletion unique index instead of
    // gracefully claiming the now-released card.
    provider.failAcquisition = false;
    const second = await service.createSeedCommitment(MACHINE_KEY);
    const secondServerSeed = requireStoredServerSeed(database, second.commitmentId);
    const secondClientSeed = findSeedLandingInBand(rules, secondServerSeed, 'base');
    const secondRip = await service.createFixtureRip({
      commitmentId: second.commitmentId,
      machineKey: MACHINE_KEY,
      recipientWallet: WALLET,
      seed: secondClientSeed,
    });

    expect(secondRip.rip.status).toBe(GachaRipStatus.SETTLED);
    expect(secondRip.rip.selectedAssetReference).toBe('devnet:fixture:asset:base');
    expect(database.rips).toHaveLength(2);
  });

  test('rejects invalid seeds and snapshots without eligible cards', async () => {
    enableFixtureMode();
    const service = serviceWith(new RipDatabase(), new RecordingProvider());

    await expect(
      service.createFixtureRip({
        commitmentId: 'unused-commitment-id',
        machineKey: MACHINE_KEY,
        recipientWallet: WALLET,
        seed: 'short',
      }),
    ).rejects.toThrow('seed is invalid');
    expect(() =>
      selectGachaOutcome(
        [{ assetReference: null, eligible: false, insuredValueMinor: null }],
        createFixtureGachaPullOddsRuleSet(SNAPSHOT_HASH),
        { clientSeed: FIXED_SEED, serverSeed: FIXED_SERVER_SEED },
      ),
    ).toThrow('has no eligible cards');
  });
});

function serviceWith(
  database: RipDatabase,
  provider: RecordingProvider,
  snapshotOverride: ReturnType<typeof snapshot> = snapshot(),
  payments: RecordingPayments = new RecordingPayments(),
): GachaRipService {
  const snapshots = {
    findLatestSealed: async () => snapshotOverride,
  } as unknown as GachaInventorySnapshotService;
  return new GachaRipService(
    database as unknown as DatabaseClient,
    snapshots,
    provider,
    payments as unknown as GachaPaymentService,
  );
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

function twoCardBaseSnapshot() {
  return {
    contentHash: SNAPSHOT_HASH,
    entries: [eligibleEntry('base-1', '10000000'), eligibleEntry('base-2', '20000000')],
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

function requireStoredServerSeed(database: RipDatabase, commitmentId: string): string {
  const commitment = database.seedCommitments.find((candidate) => candidate.id === commitmentId);
  if (!commitment) throw new Error(`no stored seed commitment for ${commitmentId}`);
  return commitment.serverSeed;
}

function rollPpmFor(rules: GachaPullOddsRuleSet, serverSeed: string, clientSeed: string): number {
  const digest = createHash('sha256')
    .update(`${rules.snapshotContentHash}:${rules.rulesHash}:${serverSeed}:${clientSeed}`)
    .digest();
  return digest.readUInt32BE(0) % 1_000_000;
}

function findSeedLandingInBand(
  rules: GachaPullOddsRuleSet,
  serverSeed: string,
  bandLabel: string,
): string {
  let lowerBound = 0;
  let upperBound = 0;
  let found = false;
  for (const band of rules.bands) {
    lowerBound = upperBound;
    upperBound += band.probabilityPpm;
    if (band.label === bandLabel) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`unknown band ${bandLabel}`);

  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const candidate = `fixture-seed-band-probe-${String(attempt).padStart(6, '0')}`;
    const rollPpm = rollPpmFor(rules, serverSeed, candidate);
    if (rollPpm >= lowerBound && rollPpm < upperBound) return candidate;
  }
  throw new Error(`could not find a client seed landing in band ${bandLabel}`);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class RecordingProvider extends SportsPackGachaProvider {
  readonly capabilities = Object.freeze({
    acquisition: true,
    odds: true,
    provider: true,
    settlement: true,
  });
  readonly mode = 'fixture' as const;
  deliverBeforeTransientFailure = false;
  deliveredAssetReferences: string[] = [];
  failAcquisition = false;
  operations: string[] = [];
  transientAcquisitionFailures = 0;

  async acquireCard(input: AcquireGachaCardInput): Promise<AcquiredGachaCard> {
    this.operations.push('acquire');
    if (this.failAcquisition) {
      throw new GachaCardDefinitelyNotAcquiredError('Fixture acquisition failed');
    }
    if (this.transientAcquisitionFailures > 0) {
      this.transientAcquisitionFailures -= 1;
      if (this.deliverBeforeTransientFailure) {
        this.deliveredAssetReferences.push(input.assetReference);
      }
      throw new ServiceUnavailableException('Fixture acquisition outcome is unknown');
    }
    this.deliveredAssetReferences.push(input.assetReference);
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
  failedAssetReference?: string | null;
  failedAt?: Date;
  failureReason?: string;
  id: string;
  idempotencyKey: string | null;
  insuredValueCurrency: string;
  insuredValueDecimals: number;
  insuredValueMinor: string;
  lifecycleLeaseExpiresAt: Date | null;
  lifecycleLeaseOwner: string | null;
  machineKey: string;
  oddsCommitmentId: string;
  oddsRulesHash: string;
  revealedAt?: Date;
  recipientWallet: string | null;
  seedCommitmentHash: string;
  // Nullable: a FAILED rip never delivered its asset, so it is released back to the
  // eligible pool (see the create() duplicate check below, which mirrors Postgres's
  // NULL-distinctness so two FAILED rips never collide on a null reference).
  selectedAssetReference: string | null;
  selectedAt: Date;
  settledAt?: Date;
  settlementReference?: string;
  snapshotContentHash: string;
  status: GachaRipStatus;
}

interface StoredSeedCommitment {
  committedAt: Date;
  consumedByRipId: string | null;
  expiresAt: Date;
  id: string;
  machineKey: string;
  serverSeed: string;
  serverSeedHash: string;
}

type StoredRipCreateInput = Omit<StoredRip, 'lifecycleLeaseExpiresAt' | 'lifecycleLeaseOwner'> &
  Partial<Pick<StoredRip, 'lifecycleLeaseExpiresAt' | 'lifecycleLeaseOwner'>>;

// Production's createSeedCommitment never includes consumedByRipId in its create
// payload (it relies on the column defaulting to NULL), so the fake's create input
// omits it too — the stored row defaults it explicitly instead.
type SeedCommitmentCreateInput = Omit<StoredSeedCommitment, 'consumedByRipId'>;

let testIdCounter = 0;

function baseRipRow(overrides: Partial<StoredRip> = {}): StoredRip {
  testIdCounter += 1;
  return {
    id: `gacharip_test_${testIdCounter}`,
    idempotencyKey: null,
    insuredValueCurrency: 'USDC',
    insuredValueDecimals: 6,
    insuredValueMinor: '35000000',
    lifecycleLeaseExpiresAt: null,
    lifecycleLeaseOwner: null,
    machineKey: MACHINE_KEY,
    oddsCommitmentId: 'gachaodds_manual',
    oddsRulesHash: 'r'.repeat(64),
    recipientWallet: WALLET,
    seedCommitmentHash: sha256(FIXED_SEED),
    selectedAssetReference: 'devnet:fixture:asset:manual',
    selectedAt: new Date(),
    snapshotContentHash: SNAPSHOT_HASH,
    status: GachaRipStatus.SELECTED,
    ...overrides,
  };
}

class UniqueConstraintViolation extends Error {}

class RipDatabase {
  oddsCommitment: Record<string, unknown> | null = null;
  rips: StoredRip[] = [];
  seedCommitments: StoredSeedCommitment[] = [];
  transitions: GachaRipStatus[] = [];

  get rip(): StoredRip | null {
    return this.rips.at(-1) ?? null;
  }

  readonly gachaPullOddsCommitment = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.oddsCommitment = data;
      return data;
    },
    findFirst: async () => this.oddsCommitment,
    findUnique: async () => this.oddsCommitment,
  };

  readonly gachaRip = {
    create: async ({ data }: { data: StoredRipCreateInput }) => {
      // Mirrors Postgres unique-index semantics: a NULL selectedAssetReference (a
      // FAILED rip whose asset was released) never collides with anything, including
      // another NULL, so only a non-null match is a real duplicate.
      const duplicate = this.rips.find(
        (rip) =>
          rip.snapshotContentHash === data.snapshotContentHash &&
          data.selectedAssetReference !== null &&
          rip.selectedAssetReference === data.selectedAssetReference,
      );
      if (duplicate) {
        throw new UniqueConstraintViolation(
          'Unique constraint failed on GachaRip_snapshotContentHash_selectedAssetReference_key',
        );
      }
      const rip = {
        lifecycleLeaseExpiresAt: null,
        lifecycleLeaseOwner: null,
        ...data,
      };
      this.rips.push(rip);
      this.transitions.push(data.status);
      return rip;
    },
    findFirst: async ({ where }: { where: { idempotencyKey: string; machineKey: string } }) => {
      return (
        this.rips.find(
          (rip) =>
            rip.machineKey === where.machineKey && rip.idempotencyKey === where.idempotencyKey,
        ) ?? null
      );
    },
    findMany: async ({
      where,
    }: {
      where: { snapshotContentHash: string; status: { not: GachaRipStatus } };
    }) => {
      return this.rips.filter(
        (rip) =>
          rip.snapshotContentHash === where.snapshotContentHash && rip.status !== where.status.not,
      );
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.rips.find((rip) => rip.id === where.id) ?? null;
    },
    update: async ({ data, where }: { data: Partial<StoredRip>; where: { id: string } }) => {
      const rip = this.rips.find((candidate) => candidate.id === where.id);
      if (!rip) throw new Error('rip missing');
      Object.assign(rip, data);
      this.transitions.push(data.status as GachaRipStatus);
      return rip;
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: Partial<StoredRip>;
      where: Record<string, unknown>;
    }) => {
      const rip = this.rips.find((candidate) => candidate.id === where.id);
      if (!rip || !matchesRipWhere(rip, where)) {
        return { count: 0 };
      }
      Object.assign(rip, data);
      if (data.status) this.transitions.push(data.status);
      return { count: 1 };
    },
  };

  readonly gachaRipSeedCommitment = {
    create: async ({ data }: { data: SeedCommitmentCreateInput }) => {
      const stored: StoredSeedCommitment = { consumedByRipId: null, ...data };
      this.seedCommitments.push(stored);
      return stored;
    },
    findUnique: async ({ where }: { where: { consumedByRipId?: string; id?: string } }) => {
      if (where.id !== undefined) {
        return this.seedCommitments.find((commitment) => commitment.id === where.id) ?? null;
      }
      if (where.consumedByRipId !== undefined) {
        return (
          this.seedCommitments.find(
            (commitment) => commitment.consumedByRipId === where.consumedByRipId,
          ) ?? null
        );
      }
      return null;
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: Partial<StoredSeedCommitment>;
      where: { consumedByRipId: null; expiresAt: { gt: Date }; id: string };
    }) => {
      const commitment = this.seedCommitments.find((candidate) => candidate.id === where.id);
      if (
        !commitment ||
        commitment.consumedByRipId !== null ||
        commitment.expiresAt.getTime() <= where.expiresAt.gt.getTime()
      ) {
        return { count: 0 };
      }
      Object.assign(commitment, data);
      return { count: 1 };
    },
  };

  readonly $executeRaw = async () => 1;

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

class RecordingPayments {
  readonly consumed: ConsumeGachaPaymentInput[] = [];
  failure: Error | null = null;

  recordConsumed(input: ConsumeGachaPaymentInput): void {
    this.consumed.push(input);
  }

  async consumeVerifiedPayment(
    _transaction: unknown,
    input: ConsumeGachaPaymentInput,
  ): Promise<void> {
    if (this.failure) throw this.failure;
    this.consumed.push(input);
  }

  async findConsumedRip(
    _transaction: unknown,
    input: FindConsumedGachaPaymentInput,
  ): Promise<string | null> {
    const payment = this.consumed.find((candidate) => candidate.intentId === input.intentId);
    if (!payment) return null;
    if (payment.machineKey !== input.machineKey || payment.payerWallet !== input.payerWallet) {
      throw new Error('Gacha payment replay changed its committed request');
    }
    return payment.ripId;
  }
}

function matchesRipWhere(rip: StoredRip, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && rip.id !== where.id) return false;
  if (
    where.lifecycleLeaseOwner !== undefined &&
    rip.lifecycleLeaseOwner !== where.lifecycleLeaseOwner
  )
    return false;
  if (typeof where.status === 'string' && rip.status !== where.status) return false;
  if (
    typeof where.status === 'object' &&
    where.status !== null &&
    'in' in where.status &&
    Array.isArray(where.status.in) &&
    !where.status.in.includes(rip.status)
  ) {
    return false;
  }
  if (Array.isArray(where.OR)) {
    return where.OR.some((candidate) => matchesRipWhere(rip, candidate as Record<string, unknown>));
  }
  const expiry = where.lifecycleLeaseExpiresAt;
  if (
    'lifecycleLeaseExpiresAt' in where &&
    expiry === null &&
    rip.lifecycleLeaseExpiresAt !== null
  ) {
    return false;
  }
  if (
    typeof expiry === 'object' &&
    expiry !== null &&
    'lte' in expiry &&
    expiry.lte instanceof Date &&
    (rip.lifecycleLeaseExpiresAt === null ||
      rip.lifecycleLeaseExpiresAt.getTime() > expiry.lte.getTime())
  ) {
    return false;
  }
  return true;
}

function enableFixtureMode(): void {
  process.env.NODE_ENV = 'test';
  process.env.DAILYDRAFT_GACHA_FIXTURE_MODE = 'true';
  delete process.env.VERCEL_ENV;
}

/** Devnet without fixtures is the only mode in which a rip must be funded. */
function enableDevnetMode(): void {
  process.env.NODE_ENV = 'test';
  delete process.env.DAILYDRAFT_GACHA_FIXTURE_MODE;
  process.env.DAILYDRAFT_PROVIDER_MODE = 'dailydraft-devnet';
  delete process.env.VERCEL_ENV;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
