import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { DatabaseClient } from '@openpacksduel/db';

import { DATABASE_CLIENT } from '../database/database.constants.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

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
      service: 'openpacksduel-api',
      status: 'ok',
      version: '0.2.0-devnet',
    };
  }
}
