import 'reflect-metadata';

import type { IncomingMessage } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import {
  createTrustedProxyPolicy,
  registerRequestBoundary,
  resolveRequestBoundaryConfig,
  resolveRequestId,
} from './common/request-boundary.js';
import { validateDeploymentEnvironment } from './config/deployment-environment.js';
import { GachaRipService } from './gacha/gacha-rip.service.js';

export interface CreateAppOptions {
  enableShutdownHooks?: boolean;
}

export async function createApp(options: CreateAppOptions = {}): Promise<NestFastifyApplication> {
  validateDeploymentEnvironment();
  const requestBoundary = resolveRequestBoundaryConfig();
  const trustedProxyPolicy = await createTrustedProxyPolicy(requestBoundary, {
    onRefreshError: (error) => {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown proxy DNS refresh error',
          event: 'trusted_proxy_dns_refresh_failed',
        }),
      );
    },
  });
  const adapter = new FastifyAdapter({
    genReqId: (request: IncomingMessage) => resolveRequestId(request.headers['x-request-id']),
    trustProxy: (address) => trustedProxyPolicy.isTrusted(address),
  });
  adapter.getInstance().addHook('onClose', (_instance, done) => {
    trustedProxyPolicy.close();
    done();
  });
  registerRequestBoundary(adapter.getInstance(), requestBoundary, {
    isTrustedProxy: (address) => trustedProxyPolicy.isTrusted(address),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  await app.get(GachaRipService).bootstrapConfiguredMachines();
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  if (options.enableShutdownHooks ?? true) app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const port = Number.parseInt(process.env.PORT ?? '3003', 10);
  await app.listen(Number.isNaN(port) ? 3003 : port, '0.0.0.0');
}

if (import.meta.main) await bootstrap();
