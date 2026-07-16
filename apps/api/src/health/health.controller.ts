import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { DatabaseClient } from '@openpacksduel/db';

import { AdminService } from '../admin/admin.service.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';

type Readiness = Awaited<ReturnType<AdminService['getReadiness']>>;

export type PublicProductCapabilities = {
  modes: {
    direct: { enabled: true };
    house: { enabled: boolean; reason: string | null };
    open: { enabled: true };
  };
  network: 'solana-devnet';
  provider: { mode: string; ready: boolean };
};

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
      service: 'openpacksduel-api',
      status: 'ok',
      version: '0.2.0-devnet',
    };
  }

  @Get('capabilities')
  @Header('Cache-Control', 'no-store')
  async getCapabilities(): Promise<PublicProductCapabilities> {
    return publicProductCapabilities(await this.admin.getReadiness());
  }
}

export function publicProductCapabilities(readiness: Readiness): PublicProductCapabilities {
  const providerReady = readiness.provider.configured && readiness.provider.verified;
  const houseReady =
    readiness.database.reachable &&
    readiness.rpc.verifiedDevnet &&
    providerReady &&
    readiness.treasury.entryEnabled &&
    readiness.treasury.verified;

  return {
    modes: {
      direct: { enabled: true },
      house: {
        enabled: houseReady,
        reason: houseReady ? null : 'House play is not ready on Solana devnet.',
      },
      open: { enabled: true },
    },
    network: 'solana-devnet',
    provider: { mode: readiness.provider.mode, ready: providerReady },
  };
}
