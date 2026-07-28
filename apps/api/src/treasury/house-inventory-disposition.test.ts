import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  HouseInventoryDisposition,
  HouseInventoryListingState,
  HouseInventoryStatus,
  HouseTreasuryLedgerType,
} from '@dailydraft/db';

import { createHouseProviderEvidence, providerReferenceKey } from './house-provider-evidence.js';
import { HouseTreasuryService } from './house-treasury.service.js';

const ORIGINAL_DISPOSITIONS = process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS;
const ORIGINAL_PROVIDER_KEYS = process.env.DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS;
const PROVIDER_KEYS = {
  'fixture-marketplace': 'fixture-marketplace-signing-key-32-bytes-minimum',
  'other-marketplace': 'other-marketplace-signing-key-32-bytes-minimum',
};

describe('house inventory dispositions', () => {
  beforeEach(() => {
    process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS = 'hold,buyback,list,promotion,manual_review';
    process.env.DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS = JSON.stringify(PROVIDER_KEYS);
  });

  afterEach(() => {
    if (ORIGINAL_DISPOSITIONS === undefined) {
      delete process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS;
    } else {
      process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS = ORIGINAL_DISPOSITIONS;
    }
    if (ORIGINAL_PROVIDER_KEYS === undefined) {
      delete process.env.DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS;
    } else {
      process.env.DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS = ORIGINAL_PROVIDER_KEYS;
    }
  });

  test.each([
    ['hold', HouseInventoryDisposition.HOLD],
    ['buyback', HouseInventoryDisposition.BUYBACK],
    ['list', HouseInventoryDisposition.LIST],
    ['manual_review', HouseInventoryDisposition.MANUAL_REVIEW],
    ['promotion', HouseInventoryDisposition.MANUAL_REVIEW],
  ] as const)('transitions %s once with its reviewed eligibility', async (requested, expected) => {
    const fixture = new DispositionDatabase();
    const service = new HouseTreasuryService(fixture as never, {} as never);
    const request = {
      disposition: requested,
      operationKey: `operation-${requested}`,
      ...(requested === 'list'
        ? {
            provider: 'fixture-marketplace',
            providerListingReference: 'listing-operation-list',
          }
        : {}),
      reason: `Review ${requested} disposition`,
    };

    await service.setDisposition(fixture.inventory.id, request);
    await service.setDisposition(fixture.inventory.id, request);

    expect(fixture.inventory.disposition).toBe(expected);
    expect(fixture.inventory.dispositionRequestedAt).toBeInstanceOf(Date);
    expect(fixture.ledger).toHaveLength(1);
    expect(fixture.ledger[0]).toMatchObject({
      idempotencyKey: `inventory-disposition:operation-${requested}`,
      type: HouseTreasuryLedgerType.INVENTORY_DISPOSITION_SET,
    });
    if (requested === 'list') {
      expect(fixture.inventory).toMatchObject({
        listingState: HouseInventoryListingState.LISTED,
        status: HouseInventoryStatus.LISTED,
      });
    }
    if (requested === 'promotion') {
      expect(fixture.inventory.dispositionReason).toContain('human approval');
    }
  });

  test('routes unavailable or expired provider capability to manual review', async () => {
    process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS = 'hold,manual_review';
    const fixture = new DispositionDatabase({
      buybackEligible: false,
      buybackExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      buybackValueAmount: null,
    });
    const service = new HouseTreasuryService(fixture as never, {} as never);

    await service.setDisposition(fixture.inventory.id, {
      disposition: 'buyback',
      operationKey: 'operation-unavailable-buyback',
      reason: 'Attempt configured buyback',
    });

    expect(fixture.inventory.disposition).toBe(HouseInventoryDisposition.MANUAL_REVIEW);
    expect(fixture.inventory.dispositionReason).toContain('not configured');
    expect(fixture.inventory.status).not.toBe(HouseInventoryStatus.DISPOSED);
  });

  test.each([
    'hold',
    'buyback',
    'manual_review',
  ] as const)('rejects listed inventory reassignment to %s until an explicit delist is reconciled', async (disposition) => {
    const fixture = new DispositionDatabase({
      disposition: HouseInventoryDisposition.LIST,
      listingState: HouseInventoryListingState.LISTED,
      status: HouseInventoryStatus.LISTED,
    });
    const service = new HouseTreasuryService(fixture as never, {} as never);

    await expect(
      service.setDisposition(fixture.inventory.id, {
        disposition,
        operationKey: `operation-listed-${disposition}`,
        reason: 'Attempt reassignment while provider listing remains live',
      }),
    ).rejects.toThrow('Listed inventory must be delisted before reassignment');
    expect(fixture.inventory).toMatchObject({
      disposition: HouseInventoryDisposition.LIST,
      listingState: HouseInventoryListingState.LISTED,
      status: HouseInventoryStatus.LISTED,
    });
    expect(fixture.ledger).toEqual([]);
  });

  test('rejects replacing one active provider listing with another before delist', async () => {
    const fixture = new DispositionDatabase();
    const service = new HouseTreasuryService(fixture as never, {} as never);
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'list',
      operationKey: 'operation-list-active-a',
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-active-a',
      reason: 'List through reviewed provider',
    });

    await expect(
      service.setDisposition(fixture.inventory.id, {
        disposition: 'list',
        operationKey: 'operation-list-active-b',
        provider: 'other-marketplace',
        providerListingReference: 'listing-active-b',
        reason: 'Unsafe replacement listing',
      }),
    ).rejects.toThrow('must be delisted before reassignment');
    expect(fixture.ledger).toHaveLength(1);
  });

  test('rejects completion of a legacy buyback state while the provider listing remains live', async () => {
    const fixture = new DispositionDatabase({
      disposition: HouseInventoryDisposition.BUYBACK,
      listingState: HouseInventoryListingState.LISTED,
      status: HouseInventoryStatus.LISTED,
    });
    const service = new HouseTreasuryService(fixture as never, {} as never);

    await expect(
      service.completeDisposition(fixture.inventory.id, {
        feeAmount: '0',
        operationKey: 'completion-listed-buyback',
        realizedAmount: '55000000',
        realizedCurrency: 'USDC',
        realizedDecimals: 6,
        reason: 'Unsafe legacy transition',
      }),
    ).rejects.toThrow('Listed inventory cannot complete a buyback before delisting');
    expect(fixture.inventory.status).toBe(HouseInventoryStatus.LISTED);
    expect(fixture.ledger).toEqual([]);
  });

  test('records net proceeds, fees, and gain or loss with exact completion replay', async () => {
    const fixture = new DispositionDatabase({ acquisitionValueAmount: '80000000' });
    const service = new HouseTreasuryService(fixture as never, {} as never);
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'list',
      operationKey: 'operation-list-card',
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-completed-card',
      reason: 'List through reviewed provider',
    });
    const saleAt = '2026-07-28T20:00:00.000Z';
    const saleEvidence = createHouseProviderEvidence(
      {
        feeAmount: '10000000',
        inventoryId: fixture.inventory.id,
        provider: 'fixture-marketplace',
        providerListingReference: 'listing-completed-card',
        providerSaleAt: saleAt,
        providerSaleReference: 'sale-completed-card',
        realizedAmount: '100000000',
        realizedCurrency: 'USDC',
        realizedDecimals: 6,
        status: 'sold',
      },
      PROVIDER_KEYS['fixture-marketplace'],
    );
    const completion = {
      feeAmount: '10000000',
      operationKey: 'completion-list-card',
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-completed-card',
      providerSaleAt: saleAt,
      providerSaleEvidenceHash: saleEvidence.hash,
      providerSaleReference: 'sale-completed-card',
      providerSaleSignature: saleEvidence.signature,
      realizedAmount: '100000000',
      realizedCurrency: 'USDC' as const,
      realizedDecimals: 6,
      reason: 'Provider sale finalized',
    };

    await service.completeDisposition(fixture.inventory.id, completion);
    await service.completeDisposition(fixture.inventory.id, completion);

    expect(fixture.inventory).toMatchObject({
      listingState: HouseInventoryListingState.SOLD,
      realizedAmount: '90000000',
      realizedFeeAmount: '10000000',
      realizedGainLossAmount: '10000000',
      status: HouseInventoryStatus.DISPOSED,
    });
    expect(fixture.ledger).toHaveLength(2);
    expect(fixture.ledger[1]).toMatchObject({
      amount: '90000000',
      idempotencyKey: `inventory-disposed:${providerReferenceKey(
        'fixture-marketplace',
        'sale-completed-card',
      )}`,
      metadata: expect.objectContaining({
        feeAmount: '10000000',
        gainLossAmount: '10000000',
        grossAmount: '100000000',
      }),
      type: HouseTreasuryLedgerType.INVENTORY_DISPOSED,
    });

    await expect(
      service.completeDisposition(fixture.inventory.id, {
        ...completion,
        realizedAmount: '110000000',
      }),
    ).rejects.toThrow('completion key was already used');
  });

  test('rejects fees above gross proceeds and non-realizable hold completion', async () => {
    const fixture = new DispositionDatabase();
    const service = new HouseTreasuryService(fixture as never, {} as never);
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'hold',
      operationKey: 'operation-hold-card',
      reason: 'Keep in custody',
    });

    await expect(
      service.completeDisposition(fixture.inventory.id, {
        feeAmount: '2',
        operationKey: 'completion-hold-card',
        realizedAmount: '1',
        realizedCurrency: 'USDC',
        realizedDecimals: 6,
        reason: 'Invalid completion',
      }),
    ).rejects.toThrow('not eligible for realized completion');
  });

  test('delists exact provider evidence once, blocks the old sale, and permits reassignment', async () => {
    const fixture = new DispositionDatabase();
    const service = new HouseTreasuryService(fixture as never, {} as never);
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'list',
      operationKey: 'operation-list-before-delist',
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-before-delist',
      reason: 'List through reviewed provider',
    });
    const cancellationEvidence = createHouseProviderEvidence(
      {
        cancelledAt: '2026-07-28T20:00:00.000Z',
        inventoryId: fixture.inventory.id,
        provider: 'fixture-marketplace',
        providerCancellationReference: 'cancellation-before-reassignment',
        providerListingReference: 'listing-before-delist',
        status: 'cancelled',
      },
      PROVIDER_KEYS['fixture-marketplace'],
    );
    const delist = {
      cancelledAt: '2026-07-28T20:00:00.000Z',
      operationKey: 'operation-delist-card',
      provider: 'fixture-marketplace',
      providerCancellationEvidenceHash: cancellationEvidence.hash,
      providerCancellationReference: 'cancellation-before-reassignment',
      providerCancellationSignature: cancellationEvidence.signature,
      providerListingReference: 'listing-before-delist',
      reason: 'Provider cancellation reconciled',
    };

    await service.delistInventory(fixture.inventory.id, delist);
    await service.delistInventory(fixture.inventory.id, delist);

    expect(fixture.inventory).toMatchObject({
      listingState: HouseInventoryListingState.UNLISTED,
      status: HouseInventoryStatus.HELD,
    });
    expect(fixture.ledger).toHaveLength(2);
    expect(fixture.ledger[1]).toMatchObject({
      idempotencyKey: `inventory-delisted:${providerReferenceKey(
        'fixture-marketplace',
        'cancellation-before-reassignment',
      )}`,
      metadata: expect.objectContaining({
        providerCancellationReference: 'cancellation-before-reassignment',
        providerListingReference: 'listing-before-delist',
        transition: 'delist',
      }),
    });
    await expect(
      service.completeDisposition(fixture.inventory.id, {
        feeAmount: '0',
        operationKey: 'completion-stale-listing',
        realizedAmount: '55000000',
        realizedCurrency: 'USDC',
        realizedDecimals: 6,
        reason: 'Stale provider sale',
      }),
    ).rejects.toThrow('Unlisted inventory cannot complete a listing sale');

    await service.setDisposition(fixture.inventory.id, {
      disposition: 'hold',
      operationKey: 'operation-hold-after-delist',
      reason: 'Return cancelled listing to custody',
    });
    expect(fixture.inventory.disposition).toBe(HouseInventoryDisposition.HOLD);

    await expect(
      service.delistInventory(fixture.inventory.id, {
        ...delist,
        reason: 'Different replay reason',
      }),
    ).rejects.toThrow('Delist operation key was already used');
  });

  test('rejects cancellation evidence that does not identify the active provider listing', async () => {
    const fixture = new DispositionDatabase();
    const service = new HouseTreasuryService(fixture as never, {} as never);
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'list',
      operationKey: 'operation-list-provider-match',
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-provider-match',
      reason: 'List through reviewed provider',
    });

    const cancellationEvidence = createHouseProviderEvidence(
      {
        cancelledAt: '2026-07-28T20:00:00.000Z',
        inventoryId: fixture.inventory.id,
        provider: 'other-marketplace',
        providerCancellationReference: 'cancellation-provider-mismatch',
        providerListingReference: 'listing-provider-match',
        status: 'cancelled',
      },
      PROVIDER_KEYS['other-marketplace'],
    );
    await expect(
      service.delistInventory(fixture.inventory.id, {
        cancelledAt: '2026-07-28T20:00:00.000Z',
        operationKey: 'operation-delist-provider-mismatch',
        provider: 'other-marketplace',
        providerCancellationEvidenceHash: cancellationEvidence.hash,
        providerCancellationReference: 'cancellation-provider-mismatch',
        providerCancellationSignature: cancellationEvidence.signature,
        providerListingReference: 'listing-provider-match',
        reason: 'Mismatched provider evidence',
      }),
    ).rejects.toThrow('does not match the active listing');
    expect(fixture.inventory).toMatchObject({
      listingState: HouseInventoryListingState.LISTED,
      status: HouseInventoryStatus.LISTED,
    });
    expect(fixture.ledger).toHaveLength(1);
  });

  test('rejects cancellation evidence timestamped before the active listing', async () => {
    const fixture = new DispositionDatabase();
    const service = new HouseTreasuryService(fixture as never, {} as never);
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'list',
      operationKey: 'operation-list-before-stale-cancellation',
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-before-stale-cancellation',
      reason: 'List through reviewed provider',
    });

    const cancellationEvidence = createHouseProviderEvidence(
      {
        cancelledAt: '2026-07-28T18:59:59.000Z',
        inventoryId: fixture.inventory.id,
        provider: 'fixture-marketplace',
        providerCancellationReference: 'cancellation-before-listing',
        providerListingReference: 'listing-before-stale-cancellation',
        status: 'cancelled',
      },
      PROVIDER_KEYS['fixture-marketplace'],
    );
    await expect(
      service.delistInventory(fixture.inventory.id, {
        cancelledAt: '2026-07-28T18:59:59.000Z',
        operationKey: 'operation-stale-cancellation',
        provider: 'fixture-marketplace',
        providerCancellationEvidenceHash: cancellationEvidence.hash,
        providerCancellationReference: 'cancellation-before-listing',
        providerCancellationSignature: cancellationEvidence.signature,
        providerListingReference: 'listing-before-stale-cancellation',
        reason: 'Stale cancellation evidence',
      }),
    ).rejects.toThrow('must follow the active listing');
  });

  test('concurrent exact delist requests converge on one evidence ledger entry', async () => {
    const fixture = new DispositionDatabase();
    const service = new HouseTreasuryService(fixture as never, {} as never);
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'list',
      operationKey: 'operation-list-concurrent-delist',
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-concurrent-delist',
      reason: 'List through reviewed provider',
    });
    const payload = {
      cancelledAt: '2026-07-28T20:00:00.000Z',
      inventoryId: fixture.inventory.id,
      provider: 'fixture-marketplace',
      providerCancellationReference: 'cancellation-concurrent-delist',
      providerListingReference: 'listing-concurrent-delist',
      status: 'cancelled',
    };
    const evidence = createHouseProviderEvidence(payload, PROVIDER_KEYS['fixture-marketplace']);
    const request = {
      cancelledAt: payload.cancelledAt,
      operationKey: 'operation-concurrent-delist',
      provider: payload.provider,
      providerCancellationEvidenceHash: evidence.hash,
      providerCancellationReference: payload.providerCancellationReference,
      providerCancellationSignature: evidence.signature,
      providerListingReference: payload.providerListingReference,
      reason: 'Provider cancellation reconciled',
    };

    const results = await Promise.all([
      service.delistInventory(fixture.inventory.id, request),
      service.delistInventory(fixture.inventory.id, request),
    ]);

    expect(results).toHaveLength(2);
    expect(fixture.ledger).toHaveLength(2);
  });

  test('rejects a delayed sale from listing A after the asset is relisted as B', async () => {
    const fixture = new DispositionDatabase();
    const service = new HouseTreasuryService(fixture as never, {} as never);
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'list',
      operationKey: 'operation-list-stale-sale-a',
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-stale-sale-a',
      reason: 'List A',
    });
    const cancellationPayload = {
      cancelledAt: '2026-07-28T20:00:00.000Z',
      inventoryId: fixture.inventory.id,
      provider: 'fixture-marketplace',
      providerCancellationReference: 'cancellation-stale-sale-a',
      providerListingReference: 'listing-stale-sale-a',
      status: 'cancelled',
    };
    const cancellationEvidence = createHouseProviderEvidence(
      cancellationPayload,
      PROVIDER_KEYS['fixture-marketplace'],
    );
    await service.delistInventory(fixture.inventory.id, {
      cancelledAt: cancellationPayload.cancelledAt,
      operationKey: 'operation-delist-stale-sale-a',
      provider: cancellationPayload.provider,
      providerCancellationEvidenceHash: cancellationEvidence.hash,
      providerCancellationReference: cancellationPayload.providerCancellationReference,
      providerCancellationSignature: cancellationEvidence.signature,
      providerListingReference: cancellationPayload.providerListingReference,
      reason: 'Cancel listing A',
    });
    await service.setDisposition(fixture.inventory.id, {
      disposition: 'list',
      operationKey: 'operation-list-stale-sale-b',
      provider: 'other-marketplace',
      providerListingReference: 'listing-stale-sale-b',
      reason: 'List B',
    });
    const salePayload = {
      feeAmount: '0',
      inventoryId: fixture.inventory.id,
      provider: 'fixture-marketplace',
      providerListingReference: 'listing-stale-sale-a',
      providerSaleAt: '2026-07-28T20:30:00.000Z',
      providerSaleReference: 'sale-stale-listing-a',
      realizedAmount: '55000000',
      realizedCurrency: 'USDC',
      realizedDecimals: 6,
      status: 'sold',
    };
    const saleEvidence = createHouseProviderEvidence(
      salePayload,
      PROVIDER_KEYS['fixture-marketplace'],
    );

    await expect(
      service.completeDisposition(fixture.inventory.id, {
        feeAmount: salePayload.feeAmount,
        operationKey: 'completion-stale-listing-a',
        provider: salePayload.provider,
        providerListingReference: salePayload.providerListingReference,
        providerSaleAt: salePayload.providerSaleAt,
        providerSaleEvidenceHash: saleEvidence.hash,
        providerSaleReference: salePayload.providerSaleReference,
        providerSaleSignature: saleEvidence.signature,
        realizedAmount: salePayload.realizedAmount,
        realizedCurrency: 'USDC',
        realizedDecimals: 6,
        reason: 'Delayed stale sale',
      }),
    ).rejects.toThrow('does not match the active listing');
    expect(fixture.inventory.status).toBe(HouseInventoryStatus.LISTED);
  });
});

type InventoryRow = {
  acquisitionValueAmount: string;
  acquisitionValueCurrency: string;
  acquisitionValueDecimals: number;
  buybackEligible: boolean;
  buybackExpiresAt: Date | null;
  buybackValueAmount: string | null;
  crashRoundId: string | null;
  disposition: HouseInventoryDisposition;
  dispositionReason: string | null;
  dispositionRequestedAt: Date | null;
  duelId: string;
  id: string;
  listingState: HouseInventoryListingState;
  listingValueAmount: string | null;
  realizedAmount: string | null;
  realizedCurrency: string | null;
  realizedDecimals: number | null;
  realizedFeeAmount: string | null;
  realizedGainLossAmount: string | null;
  status: HouseInventoryStatus;
  version: number;
};

type LedgerRow = {
  amount: string;
  createdAt: Date;
  idempotencyKey: string;
  inventoryId: string | null;
  metadata: Record<string, unknown> | null;
  type: HouseTreasuryLedgerType;
};

type DispositionTransaction = {
  $executeRaw: (...args: unknown[]) => Promise<number>;
  houseInventoryAsset: {
    findUnique: () => Promise<InventoryRow>;
    findUniqueOrThrow: () => Promise<InventoryRow>;
    updateMany: (input: {
      data: Record<string, unknown>;
      where: { version: number };
    }) => Promise<{ count: number }>;
  };
  houseTreasuryLedgerEntry: {
    create: (input: { data: Omit<LedgerRow, 'createdAt'> }) => Promise<LedgerRow>;
    findFirst: () => Promise<LedgerRow | null>;
    findUnique: (input: { where: { idempotencyKey: string } }) => Promise<LedgerRow | null>;
  };
};

class DispositionDatabase {
  readonly inventory: InventoryRow;
  readonly ledger: LedgerRow[] = [];
  private transactionQueue: Promise<void> = Promise.resolve();

  constructor(overrides: Partial<InventoryRow> = {}) {
    this.inventory = {
      acquisitionValueAmount: '50000000',
      acquisitionValueCurrency: 'USDC',
      acquisitionValueDecimals: 6,
      buybackEligible: true,
      buybackExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      buybackValueAmount: '55000000',
      crashRoundId: null,
      disposition: HouseInventoryDisposition.MANUAL_REVIEW,
      dispositionReason: null,
      dispositionRequestedAt: null,
      duelId: 'duel_disposition_fixture',
      id: 'hinv_1234567890abcdef1234567890abcdef',
      listingState: HouseInventoryListingState.UNLISTED,
      listingValueAmount: '100000000',
      realizedAmount: null,
      realizedCurrency: null,
      realizedDecimals: null,
      realizedFeeAmount: null,
      realizedGainLossAmount: null,
      status: HouseInventoryStatus.HELD,
      version: 1,
      ...overrides,
    };
  }

  $transaction<T>(operation: (transaction: DispositionTransaction) => Promise<T>) {
    const result = this.transactionQueue.then(() => operation(this.transaction()));
    this.transactionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private transaction(): DispositionTransaction {
    return {
      $executeRaw: () => Promise.resolve(1),
      houseInventoryAsset: {
        findUnique: () => Promise.resolve(this.inventory),
        findUniqueOrThrow: () => Promise.resolve(this.inventory),
        updateMany: ({
          data,
          where,
        }: {
          data: Record<string, unknown>;
          where: { version: number };
        }) => {
          if (where.version !== this.inventory.version) return Promise.resolve({ count: 0 });
          const increment = (data.version as { increment: number }).increment;
          Object.assign(this.inventory, data, { version: this.inventory.version + increment });
          return Promise.resolve({ count: 1 });
        },
      },
      houseTreasuryLedgerEntry: {
        create: ({ data }: { data: Omit<LedgerRow, 'createdAt'> }) => {
          const row = { ...data, createdAt: new Date('2026-07-28T19:00:00.000Z') };
          this.ledger.push(row);
          return Promise.resolve(row);
        },
        findUnique: ({ where }: { where: { idempotencyKey: string } }) =>
          Promise.resolve(
            this.ledger.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
          ),
        findFirst: () =>
          Promise.resolve(
            [...this.ledger]
              .reverse()
              .find((row) => row.type === HouseTreasuryLedgerType.INVENTORY_DISPOSITION_SET) ??
              null,
          ),
      },
    };
  }
}
