import { describe, expect, test } from 'bun:test';
import { DuelSide, HouseTreasuryLedgerType, type Prisma } from '@openpacksduel/db';

import { acquireHouseInventoryAsset } from './house-treasury.service.js';

const ASSET_REFERENCE = 'asset_mint_canonical';
const CUSTODY_WALLET = 'house_custody_wallet';

describe('house inventory acquisition', () => {
  test('serializes concurrent settlement retries into one asset and ledger entry', async () => {
    const database = new InventoryDatabase();
    const input = acquisition('duel_house_win', 'outcome_house_win');

    const results = await Promise.all([database.acquire(input), database.acquire(input)]);

    expect(results.map(({ created }) => created).sort()).toEqual([false, true]);
    expect(database.lockAcquisitions).toBe(2);
    expect(database.inventory).toHaveLength(1);
    expect(database.ledger).toEqual([
      expect.objectContaining({
        idempotencyKey: 'house-win-inventory:outcome_house_win',
        type: HouseTreasuryLedgerType.HOUSE_WIN_INVENTORY,
      }),
    ]);
  });

  test('rejects a second source for the same canonical asset', async () => {
    const database = new InventoryDatabase();
    await database.acquire(acquisition('duel_original', 'outcome_original'));

    await expect(
      database.acquire(acquisition('duel_duplicate', 'outcome_duplicate')),
    ).rejects.toThrow('already ledgered from another source');

    expect(database.inventory).toHaveLength(1);
    expect(database.ledger).toHaveLength(1);
  });
});

function acquisition(duelId: string, outcomeId: string) {
  return {
    custodyWallet: CUSTODY_WALLET,
    duelId,
    outcome: {
      assetReference: ASSET_REFERENCE,
      displayName: 'Canonical house card',
      id: outcomeId,
      insuredValueAmount: '42000000',
      insuredValueCurrency: 'USDC',
      insuredValueDecimals: 6,
      side: DuelSide.OPPONENT,
    },
    reason: 'house_win' as const,
    reservationId: `reservation_${duelId}`,
  };
}

interface InventoryRow {
  acquisitionValueAmount: string;
  acquisitionValueCurrency: string;
  acquisitionValueDecimals: number;
  assetReference: string;
  custodyWallet: string;
  displayName: string;
  duelId: string;
  id: string;
  insuredValueAmount: string;
  insuredValueCurrency: string;
  insuredValueDecimals: number;
  outcomeId: string;
}

interface LedgerRow {
  idempotencyKey: string;
  type: HouseTreasuryLedgerType;
}

class InventoryDatabase {
  readonly inventory: InventoryRow[] = [];
  readonly ledger: LedgerRow[] = [];
  lockAcquisitions = 0;
  #lockTail = Promise.resolve();

  acquire(input: ReturnType<typeof acquisition>) {
    return this.$transaction((transaction) => acquireHouseInventoryAsset(transaction, input));
  }

  async $transaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    let releaseLock: (() => void) | undefined;
    const transaction = {
      $queryRaw: async () => {
        releaseLock = await this.acquireLock();
        this.lockAcquisitions += 1;
        return [{ pg_advisory_xact_lock: '' }];
      },
      houseInventoryAsset: {
        create: async ({ data }: { data: InventoryRow }) => {
          this.inventory.push(data);
          return data;
        },
        findFirst: async ({ where }: { where: { assetReference: string } }) =>
          this.inventory.find((row) => row.assetReference === where.assetReference) ?? null,
        findUnique: async ({ where }: { where: { outcomeId: string } }) =>
          this.inventory.find((row) => row.outcomeId === where.outcomeId) ?? null,
      },
      houseTreasuryLedgerEntry: {
        create: async ({ data }: { data: LedgerRow }) => {
          this.ledger.push(data);
          return data;
        },
        findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
          this.ledger.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
      },
    } as unknown as Prisma.TransactionClient;

    try {
      return await operation(transaction);
    } finally {
      releaseLock?.();
    }
  }

  private async acquireLock(): Promise<() => void> {
    const previous = this.#lockTail;
    let release = () => {};
    this.#lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }
}
