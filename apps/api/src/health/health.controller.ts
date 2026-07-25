import type { DatabaseClient } from '@dailydraft/db';
import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';

import { AdminService } from '../admin/admin.service.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import { PACK_TIER_CATALOG } from '../packs/pack-catalog.js';

type Readiness = Awaited<ReturnType<AdminService['getReadiness']>>;

type PublicCapabilityAvailability = {
  enabled: boolean;
  reason: string | null;
};

export type PublicProductCapabilities = {
  modes: {
    direct: PublicCapabilityAvailability;
    house: PublicCapabilityAvailability;
    open: PublicCapabilityAvailability;
  };
  network: 'solana-devnet';
  packs: Array<
    PublicCapabilityAvailability & {
      id: string;
      name: string;
      tier: 25 | 50 | 100;
    }
  >;
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
      service: 'dailydraft-api',
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
  const duelReady = readiness.database.reachable && readiness.rpc.verifiedDevnet && providerReady;
  const duelReason = duelReady ? null : 'Duel play is not ready on Solana devnet.';
  const houseReady = duelReady && readiness.treasury.entryEnabled && readiness.treasury.verified;

  return {
    modes: {
      direct: { enabled: duelReady, reason: duelReason },
      house: {
        enabled: houseReady,
        reason: houseReady ? null : 'House play is not ready on Solana devnet.',
      },
      open: { enabled: duelReady, reason: duelReason },
    },
    network: 'solana-devnet',
    packs: PACK_TIER_CATALOG.map((pack) => ({
      enabled: pack.supported && duelReady,
      id: pack.id,
      name: pack.name,
      reason: pack.supported ? duelReason : pack.comingSoonReason,
      tier: pack.tier,
    })),
    provider: { mode: readiness.provider.mode, ready: providerReady },
  };
}
