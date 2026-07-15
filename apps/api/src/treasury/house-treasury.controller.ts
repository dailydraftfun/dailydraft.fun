import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { WorkerKeyGuard } from '../transactions/worker-key.guard.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import {
  CompleteHouseDispositionRequest,
  HouseDispositionRequest,
  HouseInventoryParams,
  HouseInventoryQuery,
} from './house-treasury.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { HouseTreasuryService } from './house-treasury.service.js';

@Controller('admin/treasury')
@UseGuards(IntegrationKeyGuard)
export class HouseTreasuryAdminController {
  constructor(private readonly treasury: HouseTreasuryService) {}

  @Get()
  @Header('cache-control', 'no-store')
  getSummary() {
    return this.treasury.getSummary();
  }

  @Get('inventory')
  @Header('cache-control', 'no-store')
  listInventory(@Query() query: HouseInventoryQuery) {
    return this.treasury.listInventory(query);
  }

  @Put('inventory/:inventoryId/disposition')
  @Header('cache-control', 'no-store')
  setDisposition(@Param() params: HouseInventoryParams, @Body() input: HouseDispositionRequest) {
    return this.treasury.setDisposition(params.inventoryId, input);
  }

  @Post('inventory/:inventoryId/disposition/complete')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  completeDisposition(
    @Param() params: HouseInventoryParams,
    @Body() input: CompleteHouseDispositionRequest,
  ) {
    return this.treasury.completeDisposition(params.inventoryId, input);
  }
}

@Controller('internal/reconciliation/treasury')
@UseGuards(WorkerKeyGuard)
export class HouseTreasuryReconciliationController {
  constructor(private readonly treasury: HouseTreasuryService) {}

  @Get()
  reconcileFromCron() {
    return this.treasury.reconcile();
  }

  @Post()
  @HttpCode(200)
  reconcileManually() {
    return this.treasury.reconcile();
  }
}
