import { Body, Controller, Get, Header, Param, Put, Query, UseGuards } from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import type { DuelIdParams } from '../duels/duel.dto.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import { AdminDuelQuery, EmergencyPauseRequest, OperatorAuditQuery } from './admin.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AdminService } from './admin.service.js';

@Controller('admin')
@UseGuards(IntegrationKeyGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('duels')
  @Header('cache-control', 'no-store')
  listAttentionDuels(@Query() query: AdminDuelQuery) {
    return this.admin.listAttentionDuels(query);
  }

  @Get('duels/:duelId/timeline')
  @Header('cache-control', 'no-store')
  getTimeline(@Param() params: DuelIdParams) {
    return this.admin.getTimeline(params.duelId);
  }

  @Get('risk')
  @Header('cache-control', 'no-store')
  getRiskSummary() {
    return this.admin.getRiskSummary();
  }

  @Get('readiness')
  @Header('cache-control', 'no-store')
  getReadiness() {
    return this.admin.getReadiness();
  }

  @Get('emergency-pause')
  @Header('cache-control', 'no-store')
  getEmergencyPause() {
    return this.admin.getEmergencyPause();
  }

  @Put('emergency-pause')
  @Header('cache-control', 'no-store')
  setEmergencyPause(@Body() input: EmergencyPauseRequest) {
    return this.admin.setEmergencyPause(input);
  }

  @Get('audit')
  @Header('cache-control', 'no-store')
  listAudit(@Query() query: OperatorAuditQuery) {
    return this.admin.listAudit(query);
  }
}
