import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  HouseInventoryDisposition,
  HouseInventoryListingState,
  HouseInventoryStatus,
  HouseTreasuryLedgerType,
} from '@dailydraft/db';

import { HouseTreasuryService } from './house-treasury.service.js';

const ORIGINAL_DISPOSITIONS = process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS;

describe('house inventory dispositions', () => {
  beforeEach(() => {
    process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS = 'hold,buyback,list,promotion,manual_review';
  });

  afterEach(() => {
    if (ORIGINAL_DISPOSITIONS === undefined) {
      delete process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS;
    } else {
      process.env.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS = ORIGINAL_DISPOSITIONS;
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
      reason: 'List through reviewed provider',
    });
    const completion = {
      feeAmount: '10000000',
      operationKey: 'completion-list-card',
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
      idempotencyKey: 'inventory-disposed:completion-list-card',
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
  idempotencyKey: string;
  inventoryId: string | null;
  metadata: Record<string, unknown> | null;
  type: HouseTreasuryLedgerType;
};

type DispositionTransaction = {
  houseInventoryAsset: {
    findUnique: () => Promise<InventoryRow>;
    findUniqueOrThrow: () => Promise<InventoryRow>;
    updateMany: (input: {
      data: Record<string, unknown>;
      where: { version: number };
    }) => Promise<{ count: number }>;
  };
  houseTreasuryLedgerEntry: {
    create: (input: { data: LedgerRow }) => Promise<LedgerRow>;
    findUnique: (input: { where: { idempotencyKey: string } }) => Promise<LedgerRow | null>;
  };
};

class DispositionDatabase {
  readonly inventory: InventoryRow;
  readonly ledger: LedgerRow[] = [];

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
    return operation(this.transaction());
  }

  private transaction(): DispositionTransaction {
    return {
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
        create: ({ data }: { data: LedgerRow }) => {
          this.ledger.push(data);
          return Promise.resolve(data);
        },
        findUnique: ({ where }: { where: { idempotencyKey: string } }) =>
          Promise.resolve(
            this.ledger.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
          ),
      },
    };
  }
}
