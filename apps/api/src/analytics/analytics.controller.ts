import { Body, Controller, Get, Header, HttpCode, Post, Query, UseGuards } from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import { AnalyticsFunnelQuery, IngestProductEventsRequest } from './analytics.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AnalyticsService } from './analytics.service.js';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('events')
  @HttpCode(202)
  @Header('cache-control', 'no-store')
  ingest(@Body() input: IngestProductEventsRequest) {
    return this.analytics.ingest(input);
  }

  @Get('funnel')
  @Header('cache-control', 'no-store')
  @UseGuards(IntegrationKeyGuard)
  getFunnel(@Query() query: AnalyticsFunnelQuery) {
    return this.analytics.getFunnel(query);
  }
}
