import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';

import { createApp } from '../src/main.js';

let applicationPromise: Promise<NestFastifyApplication> | undefined;

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  request.url = normalizeRequestUrl(request.url);
  const application = await getApplication();
  const fastify = application.getHttpAdapter().getInstance<FastifyInstance>();
  fastify.server.emit('request', request, response);
}

async function getApplication(): Promise<NestFastifyApplication> {
  applicationPromise ??= bootstrapApplication().catch((error: unknown) => {
    applicationPromise = undefined;
    throw error;
  });
  return applicationPromise;
}

async function bootstrapApplication(): Promise<NestFastifyApplication> {
  const application = await createApp({ enableShutdownHooks: false });
  await application.init();
  await application.getHttpAdapter().getInstance<FastifyInstance>().ready();
  return application;
}

export function normalizeRequestUrl(value: string | undefined): string {
  if (!value || value === '/api') return '/';
  return value.startsWith('/api/') ? value.slice('/api'.length) : value;
}
