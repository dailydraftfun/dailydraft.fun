import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { validateDeploymentEnvironment } from './config/deployment-environment.js';
import { GachaRipService } from './gacha/gacha-rip.service.js';

export interface CreateAppOptions {
  enableShutdownHooks?: boolean;
}

export async function createApp(options: CreateAppOptions = {}): Promise<NestFastifyApplication> {
  validateDeploymentEnvironment();
  const adapter = new FastifyAdapter({ trustProxy: true });
  adapter.getInstance().addHook('onRequest', (request, response, done) => {
    response.header('x-request-id', request.id);
    done();
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

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length > 0) app.enableCors({ origin: origins });

  if (options.enableShutdownHooks ?? true) app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const port = Number.parseInt(process.env.PORT ?? '3003', 10);
  await app.listen(Number.isNaN(port) ? 3003 : port, '0.0.0.0');
}

if (import.meta.main) await bootstrap();
