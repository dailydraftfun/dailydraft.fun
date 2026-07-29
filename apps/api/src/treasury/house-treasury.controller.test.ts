import { describe, expect, test } from 'bun:test';

const source = await Bun.file(new URL('./house-treasury.controller.ts', import.meta.url)).text();

describe('house treasury controller contract', () => {
  test('keeps operator reads and disposition writes integration-key guarded', () => {
    expect(source).toContain("@Controller('admin/treasury')");
    expect(source).toContain('@UseGuards(IntegrationKeyGuard)');
    expect(source).toContain("@Put('inventory/:inventoryId/disposition')");
    expect(source).toContain("@Post('inventory/:inventoryId/disposition/complete')");
    expect(source).toContain("@Post('inventory/:inventoryId/disposition/delist')");
    expect(source).toContain('this.treasury.setDisposition(params.inventoryId, input)');
    expect(source).toContain('this.treasury.completeDisposition(params.inventoryId, input)');
    expect(source).toContain('this.treasury.delistInventory(params.inventoryId, input)');
  });

  test('keeps cron and manual reconciliation on the worker-key boundary', () => {
    expect(source).toContain("@Controller('internal/reconciliation/treasury')");
    expect(source).toContain('@UseGuards(WorkerKeyGuard)');
    expect(source.match(/return this\.treasury\.reconcile\(\);/g)).toHaveLength(2);
  });

  test('marks every treasury response no-store', () => {
    expect(source.match(/@Header\('cache-control', 'no-store'\)/g)).toHaveLength(5);
  });
});
