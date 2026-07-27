import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  compareRouteInventories,
  contractFixtures,
  contractOperations,
  OPENAPI_CONTRACT_VERSION,
  operationKey,
} from '@dailydraft/contracts';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FastifyInstance, RouteOptions } from 'fastify';

import { CreateWalletChallengeRequest, CreateWalletSessionRequest } from '../auth/auth.dto.js';
import { CreateDuelRequest, DuelIdParams, PrepareTransactionRequest } from '../duels/duel.dto.js';

type OpenApiOperation = {
  operationId?: string;
  parameters?: Array<{ $ref?: string; in?: string; name?: string; required?: boolean }>;
  requestBody?: { required?: boolean };
  responses?: Record<string, unknown>;
  security?: Array<Record<string, unknown>>;
};

type OpenApiDocument = {
  info?: { version?: string };
  openapi?: string;
  paths?: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  security?: Array<Record<string, unknown>>;
  servers?: Array<{ url?: string }>;
};

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

const HTTP_METHODS = new Set<HttpMethod>(['delete', 'get', 'patch', 'post', 'put']);
const OPENAPI_PATH = new URL('../../../docs/public/openapi.yaml', import.meta.url);
const TEST_DATABASE_URL = 'postgresql://dailydraft:dailydraft@127.0.0.1:1/dailydraft_contract';

describe('API compatibility gate', () => {
  let app: NestFastifyApplication;
  let implementationRoutes: Set<string>;
  let openApi: OpenApiDocument;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= TEST_DATABASE_URL;
    const [{ AppModule }] = await Promise.all([import('../app.module.js')]);
    const adapter = new FastifyAdapter();
    implementationRoutes = new Set<string>();
    adapter.getInstance().addHook('onRoute', (route: RouteOptions) => {
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        if (method === 'HEAD' || method === 'OPTIONS') continue;
        implementationRoutes.add(operationKey(method, normalizeImplementationPath(route.url)));
      }
    });

    app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
      logger: false,
    });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();

    openApi = Bun.YAML.parse(await Bun.file(OPENAPI_PATH).text()) as OpenApiDocument;
  });

  afterAll(async () => {
    await app.close();
  });

  test('keeps the complete running Nest route inventory aligned with OpenAPI', () => {
    const specificationRoutes = openApiRouteInventory(openApi);

    expect(compareRouteInventories(implementationRoutes, specificationRoutes)).toEqual([]);
  });

  test('keeps version, base path, auth, idempotency, request, and response semantics aligned', () => {
    expect(openApi.openapi).toBe('3.1.0');
    expect(openApi.info?.version).toBe(OPENAPI_CONTRACT_VERSION);
    expect(openApi.servers?.every((server) => server.url?.endsWith('/v1'))).toBe(true);

    for (const expected of contractOperations) {
      const operation = openApi.paths?.[expected.path]?.[expected.method];
      expect(operation?.operationId).toBe(expected.operationId);
      expect(Boolean(operation?.requestBody?.required)).toBe(expected.requestRequired);
      expect(Object.hasOwn(operation?.responses ?? {}, String(expected.successStatus))).toBe(true);
      for (const status of expected.errorStatuses) {
        expect(Object.hasOwn(operation?.responses ?? {}, String(status))).toBe(true);
      }
      expect(hasIdempotencyKey(operation)).toBe(expected.idempotencyRequired);
      expect(resolveAuth(operation, openApi.security)).toEqual(expected.auth);
    }
  });

  test('accepts the versioned request fixtures through the implementation DTO validators', async () => {
    const cases: Array<[new () => object, unknown]> = [
      [CreateWalletChallengeRequest, contractFixtures.walletAuthentication.challengeRequest],
      [CreateWalletSessionRequest, contractFixtures.walletAuthentication.sessionRequest],
      [CreateDuelRequest, contractFixtures.createDuel.request],
      [PrepareTransactionRequest, contractFixtures.transactionPreparation.request],
      [DuelIdParams, { duelId: contractFixtures.duelStatus.response.id }],
      [DuelIdParams, { duelId: contractFixtures.publicProof.response.duel.id }],
    ];

    for (const [Dto, fixture] of cases) {
      const errors = await validate(plainToInstance(Dto, fixture), {
        forbidNonWhitelisted: true,
        whitelist: true,
      });
      expect(errors).toEqual([]);
    }
  });
});

function normalizeImplementationPath(path: string): string {
  const withoutPrefix = path.replace(/^\/v1(?=\/|$)/, '') || '/';
  return withoutPrefix.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/$/, '') || '/';
}

function openApiRouteInventory(document: OpenApiDocument): Set<string> {
  const routes = new Set<string>();
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (!HTTP_METHODS.has(method as HttpMethod)) continue;
      routes.add(operationKey(method, path));
    }
  }
  return routes;
}

function hasIdempotencyKey(operation: OpenApiOperation | undefined): boolean {
  return Boolean(
    operation?.parameters?.some(
      (parameter) =>
        parameter.$ref === '#/components/parameters/IdempotencyKey' ||
        (parameter.in === 'header' &&
          parameter.name?.toLowerCase() === 'idempotency-key' &&
          parameter.required === true),
    ),
  );
}

function resolveAuth(
  operation: OpenApiOperation | undefined,
  rootSecurity: Array<Record<string, unknown>> | undefined,
): 'none' | 'wallet-or-integration' | 'wallet-session' {
  const security = operation?.security ?? rootSecurity ?? [];
  if (security.length === 0) return 'none';
  const schemes = new Set(security.flatMap((entry) => Object.keys(entry)));
  if (schemes.has('walletSession') && schemes.has('integrationKey')) return 'wallet-or-integration';
  return schemes.size === 1 && schemes.has('walletSession') ? 'wallet-session' : 'none';
}
