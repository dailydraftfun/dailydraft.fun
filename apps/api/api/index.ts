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
  const fastify = application.getHttpAdapter().getInstance() as FastifyInstance;
  await dispatchRequest(fastify, request, response);
}

async function dispatchRequest(
  fastify: FastifyInstance,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await dispatchAndWaitForResponse(response, () =>
    fastify.server.emit('request', request, response),
  );
}

export function dispatchAndWaitForResponse(
  response: ServerResponse,
  dispatch: () => boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off('close', onClose);
      response.off('error', onError);
      response.off('finish', onFinish);
    };
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      if (response.writableFinished) resolve();
      else reject(new Error('Client disconnected before the API response completed'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    response.once('close', onClose);
    response.once('error', onError);
    response.once('finish', onFinish);

    try {
      if (!dispatch()) {
        cleanup();
        reject(new Error('Fastify request listener is not initialized'));
      }
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
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
  await (application.getHttpAdapter().getInstance() as FastifyInstance).ready();
  return application;
}

export function normalizeRequestUrl(value: string | undefined): string {
  if (!value) return '/';

  const url = new URL(value, 'https://openpacksduel-api.vercel.app');
  const rewrittenPath = url.searchParams.get('__path');
  if (rewrittenPath) {
    url.searchParams.delete('__path');
    url.searchParams.delete('path');
    const search = url.searchParams.size > 0 ? `?${url.searchParams.toString()}` : '';
    return `/${rewrittenPath.replace(/^\/+/, '')}${search}`;
  }

  if (url.pathname === '/api') return '/';
  if (url.pathname.startsWith('/api/')) {
    return `${url.pathname.slice('/api'.length)}${url.search}`;
  }
  return `${url.pathname}${url.search}`;
}
