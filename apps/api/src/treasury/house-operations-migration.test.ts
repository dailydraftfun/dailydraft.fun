import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL(
    '../../../../packages/db/prisma/migrations/20260729120000_house_operations_reconciliation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('house operations migration', () => {
  test('keeps the pre-cutover treasury writer compatible with the expanded snapshot', () => {
    expect(migration).toContain('ADD COLUMN "observedSlot" TEXT DEFAULT \'0\'');
    expect(migration).toContain('ALTER COLUMN "observedSlot" SET NOT NULL');
  });

  test('backfills legacy realized accounting before validating the expanded contract', () => {
    const backfill = migration.indexOf('UPDATE "HouseInventoryAsset"');
    const constraint = migration.indexOf(
      'ADD CONSTRAINT "HouseInventoryAsset_realized_accounting_check"',
    );
    const validation = migration.indexOf(
      'VALIDATE CONSTRAINT "HouseInventoryAsset_realized_accounting_check"',
    );

    expect(backfill).toBeGreaterThan(-1);
    expect(constraint).toBeGreaterThan(backfill);
    expect(validation).toBeGreaterThan(constraint);
    expect(migration).toContain('"realizedFeeAmount" = \'0\'');
    expect(migration).toContain('"realizedAmount"::NUMERIC - "acquisitionValueAmount"::NUMERIC');
    expect(migration).toContain('WHERE "realizedAmount" IS NOT NULL');
    expect(migration.slice(constraint, validation)).toContain('NOT VALID');
  });

  test('accepts both legacy and expanded realized accounting during rollback compatibility', () => {
    const constraint = migration.indexOf(
      'ADD CONSTRAINT "HouseInventoryAsset_realized_accounting_check"',
    );
    const validation = migration.indexOf(
      'VALIDATE CONSTRAINT "HouseInventoryAsset_realized_accounting_check"',
    );
    const contract = migration.slice(constraint, validation);

    expect(contract).toContain('"realizedFeeAmount" IS NULL');
    expect(contract).toContain('"realizedGainLossAmount" IS NULL');
    expect(contract).toContain('"realizedFeeAmount" ~ \'^[0-9]+$\'');
    expect(contract).toContain('"realizedGainLossAmount" ~ \'^-?[0-9]+$\'');
  });

  test('uses the Prisma-compatible truncated reconciliation index name', () => {
    expect(migration).toContain(
      'CREATE INDEX "HouseReconciliationDiscrepancy_resolvedAt_kind_firstObserve_idx"',
    );
    expect(migration).not.toContain(
      '"HouseReconciliationDiscrepancy_resolvedAt_kind_firstObservedAt_idx"',
    );
  });
});
