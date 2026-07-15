import { Module } from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
  providers: [AnalyticsService, IntegrationKeyGuard],
})
export class AnalyticsModule {}
