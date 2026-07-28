import { OPENAPI_CONTRACT_VERSION } from '@dailydraft/contracts';
import type { DatabaseClient } from '@dailydraft/db';
import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';

import { AdminService } from '../admin/admin.service.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import {
  type PublicProductCapabilities,
  publicProductCapabilities,
} from './public-product-capabilities.js';

export { publicProductCapabilities };

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    @Inject(AdminService) private readonly admin: AdminService,
  ) {}

  @Get()
  async getHealth(): Promise<{
    dependencies: { database: 'ok' };
    service: string;
    status: 'ok';
    version: string;
  }> {
    try {
      await this.database.duel.findFirst({ select: { id: true } });
    } catch {
      throw new ServiceUnavailableException('Database is unavailable or migrations are pending');
    }

    return {
      dependencies: { database: 'ok' },
      service: 'dailydraft-api',
      status: 'ok',
      version: OPENAPI_CONTRACT_VERSION,
    };
  }

  @Get('capabilities')
  @Header('Cache-Control', 'no-store')
  async getCapabilities(): Promise<PublicProductCapabilities> {
    return publicProductCapabilities(await this.admin.getReadiness());
  }
}
